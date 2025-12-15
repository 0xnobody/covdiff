// CallGraphSigma.jsx
import React, { useEffect, useRef } from "react";
import Graph from "graphology";
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents } from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import { NodeBorderProgram } from "@sigma/node-border";
import { useAppContext } from "../context/AppContext";
import { useDatabaseContext } from "../context/DatabaseContext";
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

/**
 * Calculate percentiles for a set of values
 */
const calculatePercentiles = (values) => {
    if (!values || values.length === 0) return { p90: 0, p75: 0, p50: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const p90Index = Math.floor(sorted.length * 0.9);
    const p75Index = Math.floor(sorted.length * 0.75);
    const p50Index = Math.floor(sorted.length * 0.5);

    return {
        p90: sorted[p90Index] || 0,
        p75: sorted[p75Index] || 0,
        p50: sorted[p50Index] || 0,
    };
};

/**
 * Get continuous node size based on value and percentiles
 */
const getNodeSize = (value, min, max) => {
    const minSize = 10;
    const maxSize = 140;

    if (value === 0 || max === min) return minSize;

    const normalized = (value - min) / (max - min);
    return minSize + normalized * (maxSize - minSize);
};

const getColorByConcentration = (func) => {
    const { attribution } = func;
    if (!attribution || attribution.total_new_bb === 0) {
        return "#6b7280";
    }

    const concentration =
        attribution.unique_new_bb / attribution.total_new_bb || 0;

    if (concentration > 0.8) return "#dc2626"; // red
    if (concentration > 0.5) return "#ea580c"; // orange
    if (concentration > 0.2) return "#ca8a04"; // yellow
    return "#9333ea"; // purple
};

const getFunctionColor = (func) => {
    return getColorByConcentration(func);
};

/**
 * Get border style for frontier nodes
 */
const getFrontierBorderStyle = (frontierCount, strongCount, weakCount) => {
    if (frontierCount === 0) return { width: 1, style: "solid" };

    if (strongCount > weakCount) {
        return { width: 1, style: "solid" };
    }
    return { width: 1, style: "dashed" };
};

/**
 * Build function-level call graph (graphology nodes + edges)
 */
const buildFunctionGraphology = (module) => {
    console.time("buildFunctionGraphology - Total");
    const graph = new Graph({ type: "directed" });

    console.time("  Filter functions");
    const functions = module.functions.filter(
        (f) => f.status === "new" || f.status === "changed",
    );
    console.timeEnd("  Filter functions");
    console.log(`  Filtered to ${functions.length} functions`);

    if (functions.length === 0) {
        console.timeEnd("buildFunctionGraphology - Total");
        return graph;
    }

    console.time("  Calculate sizing");
    const totalNewBBValues = functions.map((f) => f.attribution.total_new_bb);
    const minNewBB = Math.min(...totalNewBBValues);
    const maxNewBB = Math.max(...totalNewBBValues);
    console.timeEnd("  Calculate sizing");

    console.time("  Create nodes");
    functions.forEach((func) => {
        const nodeSize = getNodeSize(
            func.attribution.total_new_bb,
            minNewBB,
            maxNewBB,
        );
        const color = getFunctionColor(func);
        const border = getFrontierBorderStyle(
            func.attribution.frontier_count,
            func.attribution.strong_frontier_count,
            func.attribution.weak_frontier_count,
        );

        const id = `func_${func.func_id}`;
        const label =
            nodeSize < 40 ? "" : func.func_name || `func_${func.func_id}`;

        graph.addNode(id, {
            label,
            size: nodeSize,
            color,
            borderColor: "#000",
            borderSize: 1,
            // Much wider initial spread - critical for avoiding clustering
            x: (Math.random() - 0.5) * 1,
            y: (Math.random() - 0.5) * 1,
            type: "border",
            funcData: func,
            borderStyle: border.style,
        });
    });
    console.timeEnd("  Create nodes");

    console.time("  Build block-to-func map");
    const allFunctionCalls = new Map();
    const filteredFuncIds = new Set(functions.map((f) => f.func_id));

    const blockToFunc = new Map();
    module.functions.forEach((func) => {
        func.blocks.forEach((block) => {
            blockToFunc.set(block.bb_rva, func.func_id);
        });
    });
    console.timeEnd("  Build block-to-func map");

    console.time("  Build call graph");
    module.edges.forEach((edge) => {
        if (!edge.edge_type.includes("call")) return;

        const srcFuncId = blockToFunc.get(edge.src_bb_rva);
        const dstFuncId = blockToFunc.get(edge.dst_bb_rva);

        if (srcFuncId && dstFuncId && srcFuncId !== dstFuncId) {
            if (!allFunctionCalls.has(srcFuncId)) {
                allFunctionCalls.set(srcFuncId, new Set());
            }
            allFunctionCalls.get(srcFuncId).add(dstFuncId);
        }
    });
    console.timeEnd("  Build call graph");

    console.time("  Find transitive edges (BFS)");
    const directEdges = new Map();
    const transitiveEdges = new Map();

    let bfsIterations = 0;
    filteredFuncIds.forEach((srcId) => {
        const visited = new Set();
        const queue = [{ funcId: srcId, distance: 0 }];
        const reachable = new Map();

        while (queue.length > 0) {
            bfsIterations++;
            const { funcId, distance } = queue.shift();

            if (visited.has(funcId)) continue;
            visited.add(funcId);

            if (filteredFuncIds.has(funcId) && funcId !== srcId) {
                if (!reachable.has(funcId) || distance < reachable.get(funcId)) {
                    reachable.set(funcId, distance);
                }
            }

            const callees = allFunctionCalls.get(funcId);
            if (callees) {
                callees.forEach((calleeId) => {
                    if (!visited.has(calleeId)) {
                        queue.push({ funcId: calleeId, distance: distance + 1 });
                    }
                });
            }
        }

        reachable.forEach((distance, dstId) => {
            const dstFunc = functions.find((f) => f.func_id === dstId);
            if (!dstFunc) return;

            const edgeKey = `${srcId}_${dstId}`;
            const destNewBB = dstFunc.attribution.total_new_bb;

            if (distance === 1) {
                directEdges.set(edgeKey, destNewBB);
            } else {
                //transitiveEdges.set(edgeKey, destNewBB);
            }
        });
    });
    console.timeEnd("  Find transitive edges (BFS)");

    console.time("  Create edge elements");
    const allEdgeValues = [
        ...Array.from(directEdges.values()),
        ...Array.from(transitiveEdges.values()),
    ];
    const edgePercentiles = calculatePercentiles(allEdgeValues);

    const thicknessForValue = (destNewBB) => {
        if (destNewBB >= edgePercentiles.p90) return 4;
        if (destNewBB >= edgePercentiles.p75) return 3;
        if (destNewBB >= edgePercentiles.p50) return 2;
        return 1;
    };

    directEdges.forEach((destNewBB, key) => {
        const [srcId, dstId] = key.split("_");
        const srcNodeId = `func_${srcId}`;
        const dstNodeId = `func_${dstId}`;

        if (!graph.hasNode(srcNodeId) || !graph.hasNode(dstNodeId)) return;

        graph.addEdge(srcNodeId, dstNodeId, {
            size: thicknessForValue(destNewBB),
            color: "#000",
            type: "arrow",
        });
    });

    transitiveEdges.forEach((destNewBB, key) => {
        const [srcId, dstId] = key.split("_");
        const srcNodeId = `func_${srcId}`;
        const dstNodeId = `func_${dstId}`;

        if (!graph.hasNode(srcNodeId) || !graph.hasNode(dstNodeId)) return;

        graph.addEdge(srcNodeId, dstNodeId, {
            size: thicknessForValue(destNewBB),
            color: "#666",
            type: "arrow",
        });
    });
    console.timeEnd("  Create edge elements");

    console.timeEnd("buildFunctionGraphology - Total");
    return graph;
};

/**
 * Calculate what a color looks like at 30% opacity on white background
 */
/**
const getDimmedColor = (hexColor) => {
    const rgb = hexColor.match(/\w\w/g)?.map((x) => parseInt(x, 16));
    if (!rgb) return hexColor;

    // Blend with white background at 30% opacity
    const r = Math.round(rgb[0] * 0.3 + 255 * 0.7);
    const g = Math.round(rgb[1] * 0.3 + 255 * 0.7);
    const b = Math.round(rgb[2] * 0.3 + 255 * 0.7);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const applyFocusEffectSigma = (sigma, graph, selectedNodeId) => {
    if (!graph || !sigma) return;

    const reachable = new Set();
    reachable.add(selectedNodeId);

    const queue = [selectedNodeId];
    while (queue.length > 0) {
        const id = queue.shift();
        try {
            graph.forEachOutNeighbor(id, (neighbor) => {
                if (!reachable.has(neighbor)) {
                    reachable.add(neighbor);
                    queue.push(neighbor);
                }
            });
        } catch (e) {
            console.warn("Node not found:", id);
        }
    }

    // Use zIndex for layering - focused nodes on top
    graph.forEachNode((node) => {
        const funcData = graph.getNodeAttribute(node, "funcData");
        if (!funcData) return;

        const originalColor = getFunctionColor(funcData);

        if (reachable.has(node)) {
            graph.setNodeAttribute(node, "color", originalColor);
            graph.setNodeAttribute(node, "borderColor", "#000");
            graph.setNodeAttribute(node, "zIndex", 1);
        } else {
            graph.setNodeAttribute(node, "color", getDimmedColor(originalColor));
            graph.setNodeAttribute(node, "borderColor", getDimmedColor("#000000"));
            graph.setNodeAttribute(node, "zIndex", 0);
        }
    });

    graph.forEachEdge((edge, attrs, source, target) => {
        const visible = reachable.has(source) && reachable.has(target);
        const originalColor = attrs.color?.includes("#666") ? "#666" : "#000";

        if (visible) {
            graph.setEdgeAttribute(edge, "color", originalColor);
        } else {
            graph.setEdgeAttribute(edge, "color", getDimmedColor(originalColor));
        }
    });

    sigma.refresh();
};
*/

/**
 * Focus effect: highlight selected node and recursively reachable nodes (outgoing only)
 * Uses hidden attribute instead of opacity to avoid canvas blending issues
 */
const applyFocusEffectSigma = (sigma, graph, selectedNodeId) => {
    if (!graph || !sigma) return;

    const reachable = new Set();
    reachable.add(selectedNodeId);

    // BFS through outgoing edges only
    const queue = [selectedNodeId];
    while (queue.length > 0) {
        const id = queue.shift();
        try {
            graph.forEachOutNeighbor(id, (neighbor) => {
                if (!reachable.has(neighbor)) {
                    reachable.add(neighbor);
                    queue.push(neighbor);
                }
            });
        } catch (e) {
            console.warn("Node not found:", id);
        }
    }

    // Use zIndex to control layering - focused nodes on top
    graph.forEachNode((node) => {
        if (reachable.has(node)) {
            graph.setNodeAttribute(node, "zIndex", 1);
            graph.setNodeAttribute(node, "hidden", false);
        } else {
            graph.setNodeAttribute(node, "zIndex", 0);
            graph.setNodeAttribute(node, "hidden", true);
        }
    });

    // Hide edges that don't connect focused nodes
    graph.forEachEdge((edge, attrs, source, target) => {
        const visible = reachable.has(source) && reachable.has(target);
        graph.setEdgeAttribute(edge, "hidden", !visible);
    });

    sigma.refresh();
};



/**
 * Clear focus effect
 */
/**
 * Clear focus effect
 */
/**
 * Clear focus effect - show all nodes and edges
 */
const clearFocusEffect = (sigma, graph) => {
    if (!graph || !sigma) return;

    graph.forEachNode((node) => {
        graph.setNodeAttribute(node, "hidden", false);
        graph.setNodeAttribute(node, "zIndex", 0);
    });

    graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, "hidden", false);
    });

    sigma.refresh();
};



/**
 * Drag behavior component with click detection
 */
const DragBehavior = ({ onNodeClick }) => {
    const sigma = useSigma();
    const registerEvents = useRegisterEvents();
    const draggedNodeRef = useRef(null);
    const isDraggingRef = useRef(false);
    const dragStartPosRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const graph = sigma.getGraph();
        const DRAG_THRESHOLD = 5; // pixels

        const handleDown = (e) => {
            if (e.node) {
                isDraggingRef.current = false;
                draggedNodeRef.current = e.node;
                dragStartPosRef.current = { x: e.event.x, y: e.event.y };
                sigma.getCamera().disable();
            }
        };

        const handleMove = (e) => {
            if (draggedNodeRef.current) {
                const dx = Math.abs(e.x - dragStartPosRef.current.x);
                const dy = Math.abs(e.y - dragStartPosRef.current.y);

                if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                    isDraggingRef.current = true;
                }

                if (isDraggingRef.current) {
                    const pos = sigma.viewportToGraph(e);
                    graph.setNodeAttribute(draggedNodeRef.current, "x", pos.x);
                    graph.setNodeAttribute(draggedNodeRef.current, "y", pos.y);
                    e.preventSigmaDefault();
                    e.original.preventDefault();
                    e.original.stopPropagation();
                }
            }
        };

        const handleUp = () => {
            if (draggedNodeRef.current) {
                const wasDragging = isDraggingRef.current;
                const nodeId = draggedNodeRef.current;

                sigma.getCamera().enable();

                // If it was a click (not a drag), trigger click handler
                if (!wasDragging) {
                    onNodeClick(nodeId);
                }

                isDraggingRef.current = false;
                draggedNodeRef.current = null;
            }
        };

        const handleLeave = () => {
            if (draggedNodeRef.current) {
                isDraggingRef.current = false;
                draggedNodeRef.current = null;
                sigma.getCamera().enable();
            }
        };

        registerEvents({
            downNode: handleDown,
            mousemove: handleMove,
            mouseup: handleUp,
            mouseleave: handleLeave,
            touchmove: handleMove,
            touchend: handleUp,
        });
    }, [sigma, registerEvents, onNodeClick]);

    return null;
};


/**
 * Loader + interaction logic using hooks inside SigmaContainer
 */
const CallGraphSigmaInner = ({ module, rawCoverageData, selectedModule }) => {
    const sigma = useSigma();
    const loadGraph = useLoadGraph();
    const { selectedFunction, setSelectedFunction } = useAppContext();
    const tooltipRef = useRef(null);
    const graphRef = useRef(null);
    const registerEvents = useRegisterEvents();

    // Build and load graph when module changes
    useEffect(() => {
        if (!module) return;

        const graph = buildFunctionGraphology(module);
        graphRef.current = graph;
        loadGraph(graph);

        sigma.getCamera().animatedReset({ duration: 0 });
    }, [module, loadGraph, sigma]);

    // Click handler function
    const handleNodeClick = (node) => {
        const graph = graphRef.current;
        if (!graph) return;

        const funcData = graph.getNodeAttribute(node, "funcData");
        if (!funcData) return;

        const functionId = `func_${module.binary_id}_${funcData.func_id}`;
        const coverageModule = rawCoverageData.modules.find(
            (m) => m.binary_id === module.binary_id,
        );
        const coverageFunc = coverageModule?.functions.find(
            (f) => f.func_id === funcData.func_id,
        );

        if (coverageFunc) {
            setSelectedFunction({
                id: functionId,
                moduleId: selectedModule.id,
                name: coverageFunc.func_name,
                size: coverageFunc.func_size,
                status: coverageFunc.status,
                func_id: coverageFunc.func_id,
                entry_rva: coverageFunc.entry_rva,
                is_indirectly_called: coverageFunc.is_indirectly_called,
                attribution: coverageFunc.attribution,
                _rawData: coverageFunc,
                _moduleData: {
                    binary_id: module.binary_id,
                    module_name: module.module_name,
                },
            });
        }

        applyFocusEffectSigma(sigma, graph, node);
    };

    // Hover tooltip
    useEffect(() => {
        if (!sigma) return;
        const graph = graphRef.current;
        if (!graph) return;

        const handleEnterNode = ({ node }) => {
            const funcData = graph.getNodeAttribute(node, "funcData");
            if (!funcData) return;
            const funcName = funcData.func_name || `func_${funcData.func_id}`;

            if (tooltipRef.current) {
                tooltipRef.current.textContent = funcName;
                tooltipRef.current.style.display = "block";
            }
        };

        const handleLeaveNode = () => {
            if (tooltipRef.current) {
                tooltipRef.current.style.display = "none";
            }
        };

        const handleMouseMove = (event) => {
            if (
                tooltipRef.current &&
                tooltipRef.current.style.display === "block"
            ) {
                tooltipRef.current.style.left = `${event.x + 10}px`;
                tooltipRef.current.style.top = `${event.y + 10}px`;
            }
        };

        registerEvents({
            enterNode: handleEnterNode,
            leaveNode: handleLeaveNode,
            mousemove: handleMouseMove,
        });
    }, [sigma, registerEvents]);

    // Click on blank canvas -> deselect
    useEffect(() => {
        if (!sigma) return;
        const graph = graphRef.current;
        if (!graph) return;

        const handleClickStage = () => {
            // Clear selection
            setSelectedFunction(null);
            clearFocusEffect(sigma, graph);
        };

        registerEvents({
            clickStage: handleClickStage,
        });
    }, [sigma, registerEvents, setSelectedFunction]);

    // External selection (from treemap) -> zoom to node + focus
    useEffect(() => {
        if (!sigma) return;
        const graph = graphRef.current;
        if (!graph) return;

        if (!selectedFunction) {
            clearFocusEffect(sigma, graph);
            return;
        }

        const idParts = selectedFunction.id.split("_");
        if (idParts.length >= 3) {
            const funcId = idParts.slice(2).join("_");
            const nodeId = `func_${funcId}`;
            if (!graph.hasNode(nodeId)) return;

            const camera = sigma.getCamera();
            const pos = sigma.getNodeDisplayData(nodeId);
            if (pos) {
                camera.animate(
                    {
                        x: pos.x,
                        y: pos.y,
                        ratio: 1 / 1.5,
                    },
                    {
                        duration: 500,
                    },
                );
            }
            applyFocusEffectSigma(sigma, graph, nodeId);
        }
    }, [selectedFunction, sigma]);

    return (
        <>
            <DragBehavior onNodeClick={handleNodeClick} />
            <div
                ref={tooltipRef}
                style={{
                    position: "fixed",
                    display: "none",
                    background: "rgba(0, 0, 0, 0.85)",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    pointerEvents: "none",
                    zIndex: 10000,
                    whiteSpace: "nowrap",
                    maxWidth: "400px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            />
            <div
                style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    background: "rgba(255, 255, 255, 0.95)",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    color: "#374151",
                    zIndex: 1000,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    maxWidth: "250px",
                }}
            >
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                    Call Graph Controls
                </div>
                <div style={{ fontSize: "10px", color: "#6b7280" }}>
                    • Mouse wheel to zoom
                    <br />
                    • Drag to pan
                    <br />
                    • Drag nodes to reposition
                    <br />
                    • Click nodes to select
                </div>
            </div>
        </>
    );
};


const CallGraphSigma = () => {
    const { selectedModule } = useAppContext();
    const { rawCoverageData } = useDatabaseContext();

    if (!rawCoverageData) {
        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    fontSize: "14px",
                }}
            >
                No coverage data loaded
            </div>
        );
    }

    if (!selectedModule) {
        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    fontSize: "14px",
                }}
            >
                Select a module to view call graph
            </div>
        );
    }

    const binaryId = selectedModule.id.replace("mod_", "");
    const module = rawCoverageData.modules.find(
        (m) => m.binary_id.toString() === binaryId,
    );

    if (!module) {
        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                    fontSize: "14px",
                }}
            >
                Module not found in coverage data
            </div>
        );
    }

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <SigmaContainer
                style={{ width: "100%", height: "100%" }}
                settings={{
                    renderLabels: true,
                    labelDensity: 0.07,
                    allowInvalidContainer: true,
                    enableEdgeClickEvents: false,
                    zIndex: true,  // Enable zIndex support
                    nodeProgramClasses: {
                        border: NodeBorderProgram,
                    },
                }}
                graph={Graph}
            >
                <CallGraphSigmaInner
                    module={module}
                    rawCoverageData={rawCoverageData}
                    selectedModule={selectedModule}
                />
            </SigmaContainer>
        </div>
    );
};

export default CallGraphSigma;

