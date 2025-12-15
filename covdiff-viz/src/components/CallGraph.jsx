import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import * as d3 from 'd3';
import { useAppContext } from '../context/AppContext';
import { useDatabaseContext } from '../context/DatabaseContext';
import { useFilterContext } from '../context/FilterContext';

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
    p50: sorted[p50Index] || 0
  };
};

/**
 * Get continuous node size based on value and percentiles
 */
const getNodeSize = (value, min, max) => {
  const minSize = 20;
  const maxSize = 180;  // Increased from 80 for more dramatic sizing
  
  if (value === 0 || max === min) return minSize;
  
  // Linear interpolation between min and max size
  const normalized = (value - min) / (max - min);
  return minSize + (normalized * (maxSize - minSize));
};

/**
 * Get color based on frontier count percentage (for frontier coloring mode)
 * Uses blue-to-purple gradient based on percentile of frontier count
 */
const getColorByFrontier = (func, minFrontier, maxFrontier) => {
  const frontierCount = func.attribution?.frontier_count || 0;
  
  if (frontierCount === 0) return '#6b7280'; // gray for no frontier
  if (maxFrontier === minFrontier) return '#8b5cf6'; // single value - purple
  
  // Calculate percentage based on min/max
  const percentage = (frontierCount - minFrontier) / (maxFrontier - minFrontier);
  
  // Interpolate from blue (#3b82f6) to purple (#8b5cf6)
  return d3.interpolateRgb('#3b82f6', '#8b5cf6')(percentage);
};

/**
 * Get color based on coverage percentage (newly covered blocks / total blocks)
 * Uses orange-to-red gradient, biased for small percentages (5-10%)
 */
const getColorByCoverage = (func) => {
  // Total number of blocks in function
  const totalBlocks = func.blocks.length;
  
  // Number of newly covered blocks (status === 'new')
  const newBlocks = func.blocks.filter(block => block.status === 'new').length;
  
  if (totalBlocks === 0 || newBlocks === 0) return '#6b7280'; // gray for no coverage
  
  const coveragePercent = (newBlocks / totalBlocks) * 100;
  
  // Apply biased gradient for 5-10% range
  // 0-5%: orange (#fb923c)
  // 5-10%: orange-red transition
  // 10-25%: red transition
  // 25-99%: deep red (#dc2626)
  // 100%: bright red (#b91c1c) - fully newly covered
  
  if (coveragePercent >= 99.9) {
    // 100%: bright red for fully newly covered functions
    return '#b91c1c';
  }
  
  let t; // interpolation value 0-1
  if (coveragePercent < 5) {
    // 0-5%: light orange
    return '#fb923c';
  } else if (coveragePercent < 10) {
    // 5-10%: orange to medium orange-red (biased range)
    t = (coveragePercent - 5) / 5; // 0-1
    return d3.interpolateRgb('#fb923c', '#f97316')(t);
  } else if (coveragePercent < 25) {
    // 10-25%: medium orange-red to red
    t = (coveragePercent - 10) / 15; // 0-1
    return d3.interpolateRgb('#f97316', '#ef4444')(t);
  } else {
    // 25%+: deep red
    return '#dc2626';
  }
};

/**
 * Determine function node color based on mode (coverage or frontier)
 */
const getFunctionColor = (func, useFrontierColor = false, minFrontier = 0, maxFrontier = 0) => {
  if (useFrontierColor) {
    return getColorByFrontier(func, minFrontier, maxFrontier);
  }
  return getColorByCoverage(func);
};

/**
 * Get border style for frontier nodes
 */
const getFrontierBorderStyle = (frontierCount, strongCount, weakCount) => {
  if (frontierCount === 0) return { width: 1, style: 'solid' };
  
  if (strongCount > weakCount) {
    return { width: 1, style: 'solid' }; // thick solid
  }
  return { width: 1, style: 'dashed' }; // thin dashed
};

/**
 * Build function-level call graph (no basic blocks)
 * @param {Object} module - Module data with functions and edges
 * @param {number} maxTransitiveDistance - Maximum distance for transitive edges (0 = disabled)
 * @param {number} minFunctionSize - Minimum function size filter
 * @param {number} minNewBBCount - Minimum new BB count filter
 * @param {boolean} showUnconnected - Whether to show unconnected nodes
 * @param {boolean} showUnchanged - Whether to include unchanged functions
 * @param {boolean} useFrontierColor - Whether to use frontier count coloring instead of coverage %
 */
const buildFunctionGraph = (module, maxTransitiveDistance = 0, minFunctionSize = 0, minNewBBCount = 0, showUnconnected = false, showUnchanged = false, useFrontierColor = false) => {
  const elements = [];
  
  // Filter functions based on status and other criteria
  const functions = module.functions.filter(f => {
    // Status filter
    const statusMatch = showUnchanged 
      ? (f.status === 'new' || f.status === 'changed' || f.status === 'old')
      : (f.status === 'new' || f.status === 'changed');
    
    if (!statusMatch) return false;
    
    // Size filter
    if (f.func_size < minFunctionSize) return false;
    
    // New BB count filter (only for new/changed functions)
    if (f.status !== 'old' && f.attribution.total_new_bb < minNewBBCount) return false;
    
    return true;
  });
  
  if (functions.length === 0) {
    return elements;
  }
  
  // Calculate min/max for continuous sizing
  const totalNewBBValues = functions.map(f => f.attribution.total_new_bb);
  const minNewBB = Math.min(...totalNewBBValues);
  const maxNewBB = Math.max(...totalNewBBValues);
  
  // Calculate min/max for frontier count coloring
  const frontierCounts = functions.map(f => f.attribution?.frontier_count || 0);
  const minFrontier = Math.min(...frontierCounts);
  const maxFrontier = Math.max(...frontierCounts);
  
  // Create function nodes only
  functions.forEach((func) => {
    const nodeSize = getNodeSize(func.attribution.total_new_bb, minNewBB, maxNewBB);
    const color = getFunctionColor(func, useFrontierColor, minFrontier, maxFrontier);
    const shape = func.is_indirectly_called ? 'diamond' : 'ellipse';
    const border = getFrontierBorderStyle(
      func.attribution.frontier_count,
      func.attribution.strong_frontier_count,
      func.attribution.weak_frontier_count
    );
    
    elements.push({
      group: 'nodes',
      data: {
        id: `func_${func.func_id}`,
        label: nodeSize < 40 ? '' : (func.func_name || `func_${func.func_id}`),
        badge: func.attribution.total_new_bb,
        type: 'function',
        funcData: func
      },
      classes: border.style === 'dashed' ? 'dashed-border' : '',
      style: {
        'background-color': color,
        'width': nodeSize,
        'height': nodeSize,
        'shape': shape,
        'border-width': border.width,
        'border-color': '#000'
      }
    });
  });
  
  // Build complete call graph (including filtered-out functions) to detect transitive edges
  const allFunctionCalls = new Map(); // func_id -> Set of called func_ids
  const filteredFuncIds = new Set(functions.map(f => f.func_id));
  
  // Map block RVAs to function IDs for all functions
  const blockToFunc = new Map();
  module.functions.forEach(func => {
    func.blocks.forEach(block => {
      blockToFunc.set(block.bb_rva, func.func_id);
    });
  });
  
  // Build complete call graph
  module.edges.forEach(edge => {
    if (!edge.edge_type.includes('call')) return;
    
    const srcFuncId = blockToFunc.get(edge.src_bb_rva);
    const dstFuncId = blockToFunc.get(edge.dst_bb_rva);
    
    if (srcFuncId && dstFuncId && srcFuncId !== dstFuncId) {
      if (!allFunctionCalls.has(srcFuncId)) {
        allFunctionCalls.set(srcFuncId, new Set());
      }
      allFunctionCalls.get(srcFuncId).add(dstFuncId);
    }
  });
  
  // Find both direct and transitive edges between filtered functions
  const directEdges = new Map(); // "src_dst" -> destNewBB
  const transitiveEdges = new Map(); // "src_dst" -> destNewBB
  
  filteredFuncIds.forEach(srcId => {
    // BFS to find all reachable filtered functions
    const visited = new Set();
    const queue = [{ funcId: srcId, distance: 0 }];
    const reachable = new Map(); // funcId -> min distance
    
    while (queue.length > 0) {
      const { funcId, distance } = queue.shift();
      
      if (visited.has(funcId)) continue;
      visited.add(funcId);
      
      // Record this as reachable
      if (filteredFuncIds.has(funcId) && funcId !== srcId) {
        if (!reachable.has(funcId) || distance < reachable.get(funcId)) {
          reachable.set(funcId, distance);
        }
      }
      
      // Continue traversal
      // Always traverse at least distance 1 to find direct edges
      // If maxTransitiveDistance > 0, continue up to that distance for transitive edges
      const maxDepth = maxTransitiveDistance > 0 ? maxTransitiveDistance : 1;
      if (distance < maxDepth) {
        const callees = allFunctionCalls.get(funcId);
        if (callees) {
          callees.forEach(calleeId => {
            if (!visited.has(calleeId)) {
              queue.push({ funcId: calleeId, distance: distance + 1 });
            }
          });
        }
      }
    }
    
    // Categorize edges as direct (distance=1) or transitive (distance>1)
    reachable.forEach((distance, dstId) => {
      const srcFunc = functions.find(f => f.func_id === srcId);
      const dstFunc = functions.find(f => f.func_id === dstId);
      if (!srcFunc || !dstFunc) return;
      
      const edgeKey = `${srcId}_${dstId}`;
      const destNewBB = dstFunc.attribution.total_new_bb;
      
      if (distance === 1) {
        directEdges.set(edgeKey, destNewBB);
      } else if (maxTransitiveDistance > 0 && distance <= maxTransitiveDistance) {
        // For transitive edges, both endpoints must have significant impact
        const srcNewBB = srcFunc.attribution.total_new_bb;
        const srcConcentration = srcFunc.attribution.unique_new_bb / srcFunc.attribution.total_new_bb;
        const dstConcentration = dstFunc.attribution.unique_new_bb / dstFunc.attribution.total_new_bb;
        
        const srcSignificant = srcNewBB >= 5 || srcConcentration >= 0.3;
        const dstSignificant = destNewBB >= 5 || dstConcentration >= 0.3;
        
        if (srcSignificant && dstSignificant) {
          transitiveEdges.set(edgeKey, destNewBB);
        }
      }
    });
  });
  
  // Calculate edge thickness percentiles from all edges
  const allEdgeValues = [
    ...Array.from(directEdges.values()),
    ...Array.from(transitiveEdges.values())
  ];
  const edgePercentiles = calculatePercentiles(allEdgeValues);
  
  // Create direct edges (solid lines)
  directEdges.forEach((destNewBB, key) => {
    const [srcId, dstId] = key.split('_');
    const thickness = (() => {
      if (destNewBB >= edgePercentiles.p90) return 4;
      if (destNewBB >= edgePercentiles.p75) return 3;
      if (destNewBB >= edgePercentiles.p50) return 2;
      return 1;
    })();
    
    elements.push({
      group: 'edges',
      data: {
        id: `edge_${key}`,
        source: `func_${srcId}`,
        target: `func_${dstId}`,
        isDirect: true
      },
      style: {
        'width': thickness,
        'line-color': '#000',
        'line-style': 'solid',
        'target-arrow-color': '#000',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier'
      }
    });
  });
  
  // Create transitive edges (dashed lines)
  transitiveEdges.forEach((destNewBB, key) => {
    const [srcId, dstId] = key.split('_');
    const thickness = (() => {
      if (destNewBB >= edgePercentiles.p90) return 3;
      if (destNewBB >= edgePercentiles.p75) return 2;
      if (destNewBB >= edgePercentiles.p50) return 1.5;
      return 1;
    })();
    
    elements.push({
      group: 'edges',
      data: {
        id: `edge_transitive_${key}`,
        source: `func_${srcId}`,
        target: `func_${dstId}`,
        isDirect: false
      },
      style: {
        'width': thickness,
        'line-color': '#353535ff',
        'line-style': 'dashed',
        'target-arrow-color': '#353535ff',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.4
      }
    });
  });
  
  // Filter out unconnected nodes if showUnconnected is false
  if (!showUnconnected) {
    const connectedNodeIds = new Set();
    elements.forEach(el => {
      if (el.group === 'edges') {
        connectedNodeIds.add(el.data.source);
        connectedNodeIds.add(el.data.target);
      }
    });
    
    // Remove nodes that aren't in connectedNodeIds
    const filteredElements = elements.filter(el => 
      el.group === 'edges' || connectedNodeIds.has(el.data.id)
    );
    return filteredElements;
  }
  
  return elements;
};

/**
 * Apply focus effect: highlight selected node and recursively connected nodes
 */
const applyFocusEffect = (cy, selectedNode) => {
  // Get all nodes reachable from selected node (following outgoing edges)
  const reachableNodes = new Set();
  reachableNodes.add(selectedNode.id());
  
  const traverse = (nodeId) => {
    const node = cy.getElementById(nodeId);
    const outgoers = node.outgoers('node');
    
    outgoers.forEach(n => {
      if (!reachableNodes.has(n.id())) {
        reachableNodes.add(n.id());
        traverse(n.id());
      }
    });
  };
  
  traverse(selectedNode.id());
  
  // Apply opacity: 100% for reachable, 30% for others
  cy.nodes().forEach(node => {
    if (reachableNodes.has(node.id())) {
      node.style('opacity', 1);
    } else {
      node.style('opacity', 0.3);
    }
  });
  
  // Also dim edges that don't connect focused nodes
  cy.edges().forEach(edge => {
    const source = edge.source().id();
    const target = edge.target().id();
    if (reachableNodes.has(source) && reachableNodes.has(target)) {
      edge.style('opacity', 1);
    } else {
      edge.style('opacity', 0.3);
    }
  });
};

const CallGraph = () => {
  const { selectedModule, selectedFunction, setSelectedFunction, setSelectedBasicBlock } = useAppContext();
  const { rawCoverageData } = useDatabaseContext();
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const tooltipRef = useRef(null);
  
  // Local state for unapplied filter values
  const [localTransitiveDistance, setLocalTransitiveDistance] = React.useState(3);
  const [localMinFunctionSize, setLocalMinFunctionSize] = React.useState(128);
  const [localMinNewBBCount, setLocalMinNewBBCount] = React.useState(5);
  const [localShowUnconnected, setLocalShowUnconnected] = React.useState(false);
  const [localShowUnchanged, setLocalShowUnchanged] = React.useState(false);
  const [localUseFrontierColor, setLocalUseFrontierColor] = React.useState(false);
  
  // Applied filter values (triggers graph rebuild)
  const [appliedTransitiveDistance, setAppliedTransitiveDistance] = React.useState(3);
  const [appliedMinFunctionSize, setAppliedMinFunctionSize] = React.useState(128);
  const [appliedMinNewBBCount, setAppliedMinNewBBCount] = React.useState(5);
  const [appliedShowUnconnected, setAppliedShowUnconnected] = React.useState(false);
  const [appliedShowUnchanged, setAppliedShowUnchanged] = React.useState(false);
  const [appliedUseFrontierColor, setAppliedUseFrontierColor] = React.useState(false);
  
  // Loading state
  const [isLoading, setIsLoading] = React.useState(false);
  
  // Filters collapsed state
  const [filtersCollapsed, setFiltersCollapsed] = React.useState(false);
  
  // Legend collapsed state
  const [legendCollapsed, setLegendCollapsed] = React.useState(false);
  
  const handleApplyFilters = () => {
    setAppliedTransitiveDistance(localTransitiveDistance);
    setAppliedMinFunctionSize(localMinFunctionSize);
    setAppliedMinNewBBCount(localMinNewBBCount);
    setAppliedShowUnconnected(localShowUnconnected);
    setAppliedShowUnchanged(localShowUnchanged);
    setAppliedUseFrontierColor(localUseFrontierColor);
  };
  
  useEffect(() => {
    if (!rawCoverageData || !selectedModule || !containerRef.current) return;
    
    setIsLoading(true);
    
    // selectedModule is an object with {id, name, ...} where id is "mod_123"
    // We need to extract the binary_id from the id to match with rawCoverageData
    const binaryId = selectedModule.id.replace('mod_', '');
    const module = rawCoverageData.modules.find(m => m.binary_id.toString() === binaryId);
    
    if (!module) {
      console.warn('Module not found in rawCoverageData:', selectedModule.id);
      setIsLoading(false);
      return;
    }
    
    // Use setTimeout to prevent blocking the UI
    const timeoutId = setTimeout(() => {
      const elements = buildFunctionGraph(module, appliedTransitiveDistance, appliedMinFunctionSize, appliedMinNewBBCount, appliedShowUnconnected, appliedShowUnchanged, appliedUseFrontierColor);
      
      if (elements.length === 0) {
        console.warn('No new or changed functions found in module');
      }
      
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'text-wrap': 'ellipsis',
            'text-max-width': '80px',
            'color': '#fff',
            'text-outline-width': 2,
            'text-outline-color': '#000'
          }
        },
        {
          selector: 'node[type="function"]',
          style: {
            'font-weight': 'bold',
            'font-size': '11px'
          }
        },
        {
          selector: 'node.dashed-border',
          style: {
            'border-style': 'dashed'
          }
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle'
          }
        }
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: 8000,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        gravity: 1,
        numIter: 1000,
        randomize: false
      },
      wheelSensitivity: 2
    });
    
    // Fit the graph to viewport
    cyRef.current.fit(null, 50);
    
    // Add click handler for function selection
    cyRef.current.on('tap', 'node[type="function"]', (event) => {
      const node = event.target;
      const funcData = node.data('funcData');
      const functionId = `func_${module.binary_id}_${funcData.func_id}`;
      
      // Find the corresponding function in coverageData for unified data structure
      const coverageFunc = rawCoverageData.modules
        .find(m => m.binary_id === module.binary_id)
        ?.functions.find(f => f.func_id === funcData.func_id);
      
      if (coverageFunc) {
        // Create a unified selection object matching the coverageData structure
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
          _moduleData: { binary_id: module.binary_id, module_name: module.module_name }
        });
        // Clear basic block selection when function is selected
        setSelectedBasicBlock(null);
      }
      
      // Apply focus effect: highlight this node and all recursively connected nodes
      applyFocusEffect(cyRef.current, node);
    });
    
    // Add click handler for background (deselect)
    cyRef.current.on('tap', (event) => {
      // If clicked on background (not on a node or edge)
      if (event.target === cyRef.current) {
        setSelectedFunction(null);
        // Clear focus effect
        if (cyRef.current) {
          cyRef.current.nodes().style('opacity', 1);
          cyRef.current.edges().style('opacity', 1);
        }
      }
    });
    
    // Add tooltip on hover
    cyRef.current.on('mouseover', 'node[type="function"]', (event) => {
      const node = event.target;
      const funcName = node.data('funcData').func_name || `func_${node.data('funcData').func_id}`;
      
      if (tooltipRef.current) {
        tooltipRef.current.textContent = funcName;
        tooltipRef.current.style.display = 'block';
      }
    });
    
    cyRef.current.on('mouseout', 'node[type="function"]', () => {
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'none';
      }
    });
    
    cyRef.current.on('mousemove', (event) => {
      if (tooltipRef.current && tooltipRef.current.style.display === 'block') {
        tooltipRef.current.style.left = (event.originalEvent.clientX + 10) + 'px';
        tooltipRef.current.style.top = (event.originalEvent.clientY + 10) + 'px';
      }
    });

      setIsLoading(false);
    }, 0);
    
    return () => {
      clearTimeout(timeoutId);
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [rawCoverageData, selectedModule, appliedTransitiveDistance, appliedMinFunctionSize, appliedMinNewBBCount, appliedShowUnconnected, appliedShowUnchanged, appliedUseFrontierColor]);
  
  // React to function selection from treemap: zoom to node
  useEffect(() => {
    if (!cyRef.current || !selectedFunction) {
      // Clear focus effect if nothing selected
      if (cyRef.current) {
        cyRef.current.nodes().style('opacity', 1);
        cyRef.current.edges().style('opacity', 1);
      }
      return;
    }
    
    // Extract func_id from the selected function ID
    // Format is: func_<binary_id>_<func_id>
    const idParts = selectedFunction.id.split('_');
    if (idParts.length >= 3) {
      const funcId = idParts.slice(2).join('_'); // Handle func_ids with underscores
      const nodeId = `func_${funcId}`;
      const node = cyRef.current.getElementById(nodeId);
      
      if (node && node.length > 0) {
        // Zoom to the selected node
        cyRef.current.animate({
          center: { eles: node },
          zoom: 1.5,
          duration: 500,
          easing: 'ease-in-out-cubic'
        });
        
        // Apply focus effect
        applyFocusEffect(cyRef.current, node);
      }
    }
  }, [selectedFunction]);
  
  if (!rawCoverageData) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: '14px'
      }}>
        No coverage data loaded
      </div>
    );
  }
  
  if (!selectedModule) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: '14px'
      }}>
        Select a module to view call graph
      </div>
    );
  }
  
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(255, 255, 255, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid #e5e7eb',
            borderTop: '4px solid #667eea',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        </div>
      )}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          display: 'none',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          pointerEvents: 'none',
          zIndex: 10000,
          whiteSpace: 'nowrap',
          maxWidth: '400px',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      />
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '11px',
        color: '#374151',
        zIndex: 1000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        maxWidth: '250px'
      }}>
        <div 
          style={{ 
            fontWeight: 'bold', 
            marginBottom: '6px',
            cursor: 'pointer',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
          onClick={() => setFiltersCollapsed(!filtersCollapsed)}
        >
          <span>Call Graph Controls</span>
          <span style={{ fontSize: '14px' }}>{filtersCollapsed ? '▼' : '▲'}</span>
        </div>
        
        {!filtersCollapsed && (
          <>
            <div style={{ marginBottom: '6px' }}>
              <label style={{ fontSize: '10px', color: '#374151', display: 'block', marginBottom: '2px' }}>
                Transitive edge distance:
              </label>
              <input
                type="number"
                min="0"
                max="10"
                value={localTransitiveDistance}
                onChange={(e) => setLocalTransitiveDistance(parseInt(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '2px 4px',
                  fontSize: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px'
                }}
              />
              <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '1px' }}>0 = disabled</div>
            </div>
            <div style={{ marginBottom: '6px' }}>
              <label style={{ fontSize: '10px', color: '#374151', display: 'block', marginBottom: '2px' }}>
                Min function size (bytes):
              </label>
              <input
                type="number"
                min="0"
                value={localMinFunctionSize}
                onChange={(e) => setLocalMinFunctionSize(parseInt(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '2px 4px',
                  fontSize: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px'
                }}
              />
            </div>
            <div style={{ marginBottom: '6px' }}>
              <label style={{ fontSize: '10px', color: '#374151', display: 'block', marginBottom: '2px' }}>
                Min new BB count:
              </label>
              <input
                type="number"
                min="0"
                value={localMinNewBBCount}
                onChange={(e) => setLocalMinNewBBCount(parseInt(e.target.value) || 0)}
                style={{
                  width: '100%',
                  padding: '2px 4px',
                  fontSize: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px'
                }}
              />
            </div>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              marginBottom: '6px',
              fontSize: '11px',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={localShowUnconnected}
                onChange={(e) => setLocalShowUnconnected(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Show unconnected nodes
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              marginBottom: '6px',
              fontSize: '11px',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={localShowUnchanged}
                onChange={(e) => setLocalShowUnchanged(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Show unchanged functions
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              marginBottom: '6px',
              fontSize: '11px',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={localUseFrontierColor}
                onChange={(e) => setLocalUseFrontierColor(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Color by frontier count
            </label>
            <button
              onClick={handleApplyFilters}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: '600',
                color: '#fff',
                background: isLoading ? '#9ca3af' : '#667eea',
                border: 'none',
                borderRadius: '4px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                marginBottom: '6px'
              }}
            >
              {isLoading ? 'Building...' : 'Apply Filters'}
            </button>
          </>
        )}
        
        <div style={{ fontSize: '10px', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: '6px' }}>
          • Mouse wheel to zoom<br/>
          • Drag to pan<br/>
          • Click nodes to select
        </div>
      </div>
      
      {/* Legend Panel */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '10px',
        color: '#374151',
        zIndex: 1000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: '180px'
      }}>
        <div 
          style={{ 
            fontWeight: 'bold', 
            marginBottom: '6px', 
            fontSize: '11px', 
            color: '#1f2937',
            cursor: 'pointer',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
          onClick={() => setLegendCollapsed(!legendCollapsed)}
        >
          <span>Legend</span>
          <span style={{ fontSize: '14px' }}>{legendCollapsed ? '▼' : '▲'}</span>
        </div>
        
        {!legendCollapsed && (
          <>
            {/* Colors */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: '600', fontSize: '9px', color: '#6b7280', marginBottom: '3px' }}>
                {appliedUseFrontierColor ? 'Frontier Count' : 'Coverage %'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {appliedUseFrontierColor ? (
                  // Frontier count legend
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#6b7280', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>No frontier</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#3b82f6', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>Low frontier count</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>Medium frontier count</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#8b5cf6', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>High frontier count</span>
                    </div>
                  </>
                ) : (
                  // Coverage % legend
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#6b7280', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>0% - No new coverage</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#fb923c', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>&lt;5% - Low</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#f97316', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>~10% - Typical</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#dc2626', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>25%+ - High</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                      <div style={{ width: '10px', height: '10px', backgroundColor: '#b91c1c', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                      <span style={{ color: '#374151' }}>100% - Complete</span>
                    </div>
                  </>
                )}
              </div>
            </div>
        
            {/* Size */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: '600', fontSize: '9px', color: '#6b7280', marginBottom: '3px' }}>Node Size</div>
              <div style={{ fontSize: '10px', color: '#374151' }}>Total new BB count</div>
            </div>
            
            {/* Shape */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: '600', fontSize: '9px', color: '#6b7280', marginBottom: '3px' }}>Node Shape</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '10px', height: '10px', backgroundColor: '#9ca3af', borderRadius: '50%', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Circle - Direct call</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '10px', height: '10px', backgroundColor: '#9ca3af', transform: 'rotate(45deg)', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Diamond - Indirect call</span>
                </div>
              </div>
            </div>
            
            {/* Border */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: '600', fontSize: '9px', color: '#6b7280', marginBottom: '3px' }}>Node Border</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '10px', height: '10px', border: '2px solid #000', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Solid - Strong frontier</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '10px', height: '10px', border: '2px dashed #000', borderRadius: '2px', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Dashed - Weak frontier</span>
                </div>
              </div>
            </div>
            
            {/* Edges */}
            <div>
              <div style={{ fontWeight: '600', fontSize: '9px', color: '#6b7280', marginBottom: '3px' }}>Edges</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '16px', height: '0', borderTop: '2px solid #000', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Solid - Direct call</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                  <div style={{ width: '16px', height: '0', borderTop: '2px dashed #999', marginRight: '4px', flexShrink: 0 }}></div>
                  <span style={{ color: '#374151' }}>Dashed - Transitive</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default CallGraph;