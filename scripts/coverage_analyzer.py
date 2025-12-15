#!/usr/bin/env python3
"""
Coverage Diff Analysis Tool
Analyzes coverage differences between two samples using static binary analysis data.

IMPORTANT: master.db and cov_a_b.db use completely separate ID spaces.
- master.db uses binary_id
- cov_a_b.db uses module_id
These are matched via sha256_hash in the module_binary_map table.
"""

import argparse
import sqlite3
import json
import sys
from collections import defaultdict
from pathlib import Path

import networkx as nx


def create_analysis_tables(conn):
    """Create tables for analysis results."""
    cur = conn.cursor()

    # Module to binary mapping (CRITICAL: maps module_id -> binary_id via sha256)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS module_binary_map (
            module_id INTEGER PRIMARY KEY,
            binary_id INTEGER NOT NULL,
            module_name TEXT,
            binary_name TEXT,
            sha256_hash TEXT
        )
    """)

    # RVA to basic block mapping cache (for return addresses)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rva_to_bb_cache (
            binary_id INTEGER NOT NULL,
            instruction_rva INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            PRIMARY KEY (binary_id, instruction_rva)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rva_to_bb_binary ON rva_to_bb_cache(binary_id)")

    # Joined coverage tables (use binary_id from master.db)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cov_A_blocks_joined (
            binary_id INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            hit_A INTEGER DEFAULT 1,
            PRIMARY KEY (binary_id, bb_rva)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cov_B_blocks_joined (
            binary_id INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            hit_B INTEGER DEFAULT 1,
            PRIMARY KEY (binary_id, bb_rva)
        )
    """)

    # Block labels (diff)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS bb_labels (
            binary_id INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            in_A INTEGER NOT NULL,
            in_B INTEGER NOT NULL,
            is_new INTEGER NOT NULL,
            PRIMARY KEY (binary_id, bb_rva)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bb_labels_new ON bb_labels(binary_id, is_new)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_bb_labels_binary ON bb_labels(binary_id)")

    # Executed graph G_B (all use binary_id)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS graph_B_nodes (
            binary_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            func_id INTEGER,
            is_new INTEGER NOT NULL,
            in_A INTEGER NOT NULL,
            PRIMARY KEY (binary_id, bb_rva)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS graph_B_edges (
            binary_id INTEGER NOT NULL,
            src_bb_rva INTEGER NOT NULL,
            dst_bb_rva INTEGER NOT NULL,
            edge_type TEXT NOT NULL,
            PRIMARY KEY (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_B_edges_src ON graph_B_edges(binary_id, src_bb_rva)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_B_edges_dst ON graph_B_edges(binary_id, dst_bb_rva)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_B_edges_binary ON graph_B_edges(binary_id)")

    # Frontier edges and targets
    cur.execute("""
        CREATE TABLE IF NOT EXISTS frontier_edges (
            binary_id INTEGER NOT NULL,
            src_bb_rva INTEGER NOT NULL,
            dst_bb_rva INTEGER NOT NULL,
            edge_type TEXT NOT NULL,
            PRIMARY KEY (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS frontier_targets (
            binary_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            frontier_type TEXT NOT NULL,
            PRIMARY KEY (binary_id, bb_rva)
        )
    """)

    # Reachability from frontier blocks to new blocks
    cur.execute("""
        CREATE TABLE IF NOT EXISTS frontier_reachability (
            binary_id INTEGER NOT NULL,
            frontier_bb_rva INTEGER NOT NULL,
            new_bb_rva INTEGER NOT NULL,
            PRIMARY KEY (binary_id, frontier_bb_rva, new_bb_rva)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_frontier_reachability_frontier ON frontier_reachability(binary_id, frontier_bb_rva)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_frontier_reachability_new ON frontier_reachability(binary_id, new_bb_rva)")

    # Attribution results
    cur.execute("""
        CREATE TABLE IF NOT EXISTS frontier_attribution (
            binary_id INTEGER NOT NULL,
            frontier_bb_rva INTEGER NOT NULL,
            attributed_new_bb_count INTEGER NOT NULL,
            unique_new_bb_count INTEGER NOT NULL,
            shared_new_bb_count INTEGER NOT NULL,
            attributed_new_func_count INTEGER NOT NULL,
            PRIMARY KEY (binary_id, frontier_bb_rva)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bb_attributed_to (
            binary_id INTEGER NOT NULL,
            new_bb_rva INTEGER NOT NULL,
            frontier_bb_rva INTEGER,
            is_shared INTEGER NOT NULL,
            PRIMARY KEY (binary_id, new_bb_rva)
        )
    """)

    # Aggregated scores
    cur.execute("""
        CREATE TABLE IF NOT EXISTS function_unlock_scores (
            binary_id INTEGER NOT NULL,
            func_id INTEGER NOT NULL,
            func_name TEXT NOT NULL,
            unique_new_bb INTEGER NOT NULL,
            shared_new_bb INTEGER NOT NULL,
            total_new_bb INTEGER NOT NULL,
            frontier_count INTEGER NOT NULL,
            strong_frontier_count INTEGER NOT NULL,
            weak_frontier_count INTEGER NOT NULL,
            PRIMARY KEY (binary_id, func_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS callsite_unlock_scores (
            binary_id INTEGER NOT NULL,
            src_bb_rva INTEGER NOT NULL,
            src_func_id INTEGER NOT NULL,
            src_func_name TEXT,
            dst_func_id INTEGER,
            dst_func_name TEXT,
            unique_new_bb INTEGER NOT NULL,
            shared_new_bb INTEGER NOT NULL,
            total_new_bb INTEGER NOT NULL,
            PRIMARY KEY (binary_id, src_bb_rva, dst_func_id)
        )
    """)

    conn.commit()


def find_containing_basic_block(master_cur, cov_cur, binary_id, instruction_rva):
    """
    Find the basic block that contains a given instruction RVA.
    This handles return addresses and other mid-block addresses.
    
    Returns: (bb_rva, func_id) or None if not found
    """
    # Check cache first
    cov_cur.execute(
        "SELECT bb_rva, func_id FROM rva_to_bb_cache WHERE binary_id = ? AND instruction_rva = ?",
        (binary_id, instruction_rva)
    )
    result = cov_cur.fetchone()
    if result:
        return result
    
    # Try exact match first (instruction_rva is a BB start)
    master_cur.execute(
        "SELECT bb_rva, func_id FROM basic_blocks WHERE binary_id = ? AND bb_rva = ?",
        (binary_id, instruction_rva)
    )
    result = master_cur.fetchone()
    if result:
        bb_rva, func_id = result
        # Cache it
        cov_cur.execute(
            "INSERT OR IGNORE INTO rva_to_bb_cache VALUES (?, ?, ?, ?)",
            (binary_id, instruction_rva, bb_rva, func_id)
        )
        return (bb_rva, func_id)
    
    # Not a BB start - find containing BB using bb_start_va and bb_end_va
    # instruction_rva should satisfy: bb_rva <= instruction_rva < bb_end_rva
    master_cur.execute("""
        SELECT bb_rva, func_id, bb_end_va - bb_start_va as bb_size
        FROM basic_blocks
        WHERE binary_id = ? AND bb_rva <= ?
        ORDER BY bb_rva DESC
        LIMIT 1
    """, (binary_id, instruction_rva))
    result = master_cur.fetchone()
    
    if result:
        bb_rva, func_id, bb_size = result
        # Verify instruction is within the BB bounds
        if instruction_rva <= bb_rva + bb_size:
            # Cache it
            cov_cur.execute(
                "INSERT OR IGNORE INTO rva_to_bb_cache VALUES (?, ?, ?, ?)",
                (binary_id, instruction_rva, bb_rva, func_id)
            )
            return (bb_rva, func_id)
    
    return None


def map_modules_to_binaries(cov_conn, master_conn):
    """
    Create module to binary mapping via SHA256 hash.

    CRITICAL: module_id (cov db) and binary_id (master db) are separate ID spaces.
    This mapping is the ONLY way to correlate them.
    """
    print("Step 1: Mapping modules to binaries via SHA256...")

    cov_cur = cov_conn.cursor()
    master_cur = master_conn.cursor()

    # Get all modules from coverage DB
    cov_cur.execute("SELECT id, name, sha256_hash FROM modules")
    modules = cov_cur.fetchall()

    mapping = []
    unmapped = []

    for module_id, module_name, sha256_hash in modules:
        # Find matching binary in master DB by SHA256
        master_cur.execute(
            "SELECT binary_id, binary_name FROM analyzed_binaries WHERE sha256_hash = ?",
            (sha256_hash,)
        )
        result = master_cur.fetchone()

        if result:
            binary_id, binary_name = result
            mapping.append((module_id, binary_id, module_name, binary_name, sha256_hash))
            print(f"  Mapped module_id={module_id} ({module_name}) -> binary_id={binary_id} ({binary_name})")
        else:
            unmapped.append((module_id, module_name, sha256_hash))
            print(f"  WARNING: No binary found for module_id={module_id} ({module_name}, {sha256_hash})")

    # Insert mapping
    if mapping:
        cov_cur.executemany(
            "INSERT OR REPLACE INTO module_binary_map (module_id, binary_id, module_name, binary_name, sha256_hash) VALUES (?, ?, ?, ?, ?)",
            mapping
        )
        cov_conn.commit()

    print(f"  Successfully mapped {len(mapping)} modules to binaries")
    if unmapped:
        print(f"  WARNING: {len(unmapped)} modules could not be mapped")

    return len(mapping), unmapped


def join_coverage_to_blocks(cov_conn, master_conn, sample_name, blocks_table, edges_table=None):
    """
    Join coverage data to basic blocks.
    
    IMPORTANT: Handles return addresses by mapping them to their containing basic blocks.
    """
    print(f"Step 2: Joining coverage {sample_name} to basic blocks...")

    cov_cur = cov_conn.cursor()
    master_cur = master_conn.cursor()

    missing_blocks = []
    joined_data = []
    processed_blocks = set()
    
    stats = {
        'direct_blocks': 0,
        'edge_src_blocks': 0,
        'edge_dst_blocks': 0,
        'return_addresses_mapped': 0,
        'unmapped': 0
    }

    # Get coverage blocks with module_id
    cov_cur.execute(f"SELECT module_id, bb_rva FROM {blocks_table}")
    coverage_blocks = cov_cur.fetchall()
    stats['direct_blocks'] = len(coverage_blocks)

    # Also get blocks from edges (both conditional branches and return address edges)
    if edges_table:
        cov_cur.execute(f"SELECT module_id, src_bb_rva, dst_bb_rva FROM {edges_table}")
        for module_id, src_rva, dst_rva in cov_cur.fetchall():
            coverage_blocks.append((module_id, src_rva))
            coverage_blocks.append((module_id, dst_rva))
            stats['edge_src_blocks'] += 1
            stats['edge_dst_blocks'] += 1

    print(f"  Processing {len(coverage_blocks)} coverage entries...")
    print(f"    Direct blocks: {stats['direct_blocks']}")
    print(f"    Edge sources: {stats['edge_src_blocks']}")
    print(f"    Edge destinations: {stats['edge_dst_blocks']}")

    for module_id, instruction_rva in coverage_blocks:
        # Skip if already processed
        block_key = (module_id, instruction_rva)
        if block_key in processed_blocks:
            continue
        processed_blocks.add(block_key)
        
        # Map module_id -> binary_id
        cov_cur.execute("SELECT binary_id FROM module_binary_map WHERE module_id = ?", (module_id,))
        result = cov_cur.fetchone()

        if not result:
            missing_blocks.append({
                'module_id': module_id,
                'instruction_rva': instruction_rva,
                'reason': 'module_not_mapped'
            })
            stats['unmapped'] += 1
            continue

        binary_id = result[0]

        # Find the containing basic block (handles both BB starts and return addresses)
        result = find_containing_basic_block(master_cur, cov_cur, binary_id, instruction_rva)
        
        if result:
            bb_rva, func_id = result
            joined_data.append((binary_id, func_id, bb_rva))
            
            # Track if we mapped a return address
            if bb_rva != instruction_rva:
                stats['return_addresses_mapped'] += 1
        else:
            missing_blocks.append({
                'module_id': module_id,
                'binary_id': binary_id,
                'instruction_rva': instruction_rva,
                'reason': 'not_found_in_static_analysis'
            })
            stats['unmapped'] += 1

    # Insert joined data
    target_table = f"cov_{sample_name}_blocks_joined"
    cov_cur.executemany(
        f"INSERT OR IGNORE INTO {target_table} (binary_id, func_id, bb_rva) VALUES (?, ?, ?)",
        joined_data
    )
    cov_conn.commit()

    print(f"  Joined {len(joined_data)} unique blocks")
    print(f"    Return addresses mapped to BBs: {stats['return_addresses_mapped']}")
    print(f"    Missing/unmapped: {len(missing_blocks)}")
    
    return missing_blocks


def compute_diff_labels(cov_conn):
    """Compute diff labels (in_A, in_B, is_new)."""
    print("Step 3: Computing diff labels...")

    cur = cov_conn.cursor()

    cur.execute("""
        INSERT INTO bb_labels (binary_id, func_id, bb_rva, in_A, in_B, is_new)
        SELECT 
            binary_id,
            func_id,
            bb_rva,
            MAX(in_A) as in_A,
            MAX(in_B) as in_B,
            CASE WHEN MAX(in_B) = 1 AND MAX(in_A) = 0 THEN 1 ELSE 0 END as is_new
        FROM (
            SELECT binary_id, func_id, bb_rva, 1 as in_A, 0 as in_B
            FROM cov_A_blocks_joined
            UNION ALL
            SELECT binary_id, func_id, bb_rva, 0 as in_A, 1 as in_B
            FROM cov_B_blocks_joined
        )
        GROUP BY binary_id, bb_rva
    """)

    cov_conn.commit()

    count = cur.execute("SELECT COUNT(*) FROM bb_labels WHERE is_new = 1").fetchone()[0]
    print(f"  Found {count} new blocks in B")
    return count


def expand_deterministic_for_sample(cov_conn, master_conn, sample_name):
    """
    Expand deterministic paths for a specific sample (A or B).
    
    Problem: Coverage only records non-deterministic edges (conditional branches).
    If execution goes X->Y->Z where X->Y is deterministic (fallthrough/unconditional)
    and Y->Z is conditional, only X->Z is recorded, missing Y.
    
    Solution: For each covered block, transitively add all blocks reachable via
    deterministic-only edges (fallthrough/branch_unconditional) until hitting:
    - Another covered block
    - A block with multiple successors (conditional branch - non-deterministic)
    - End of path
    """
    print(f"Expanding deterministic paths for sample {sample_name}...")
    
    cov_cur = cov_conn.cursor()
    master_cur = master_conn.cursor()
    
    source_table = f'cov_{sample_name}_blocks_joined'
    
    # Get all binaries in this sample
    binaries = cov_cur.execute(f"SELECT DISTINCT binary_id FROM {source_table}").fetchall()
    
    total_added = 0
    
    for (binary_id,) in binaries:
        print(f"  Processing binary {binary_id}...")
        
        # Get all blocks currently in this sample's coverage
        cov_cur.execute(f"SELECT bb_rva FROM {source_table} WHERE binary_id = ?", (binary_id,))
        covered_blocks = set(row[0] for row in cov_cur.fetchall())
        
        # Build CFG with edge types
        master_cur.execute("""
            SELECT src_bb_rva, dst_bb_rva, edge_kind
            FROM cfg_edges
            WHERE binary_id = ?
        """, (binary_id,))
        
        # Group by source to identify deterministic blocks
        from collections import defaultdict
        cfg = defaultdict(list)  # src -> [(dst, kind), ...]
        for src, dst, kind in master_cur.fetchall():
            cfg[src].append((dst, kind if kind else 'unknown'))
        
        # For each covered block, follow deterministic edges to find intermediates
        newly_discovered = set()
        
        for start_bb in covered_blocks:
            from collections import deque
            queue = deque([start_bb])
            visited_from_start = {start_bb}
            
            while queue:
                current = queue.popleft()
                
                if current not in cfg:
                    continue
                
                successors = cfg[current]
                
                # Deterministic = single successor that is fallthrough or unconditional branch
                if len(successors) == 1:
                    dst, kind = successors[0]
                    if kind in ('fallthrough', 'branch_unconditional'):
                        if dst not in visited_from_start:
                            visited_from_start.add(dst)
                            
                            # If dst is not yet covered, it's an intermediate block
                            if dst not in covered_blocks:
                                newly_discovered.add(dst)
                                # Continue traversing
                                queue.append(dst)
                            # If dst is covered, stop - let that block handle its expansion
        
        # Add newly discovered blocks to this sample's coverage table
        if newly_discovered:
            blocks_to_add = []
            for bb_rva in newly_discovered:
                # Look up func_id
                master_cur.execute(
                    "SELECT func_id FROM basic_blocks WHERE binary_id = ? AND bb_rva = ?",
                    (binary_id, bb_rva)
                )
                result = master_cur.fetchone()
                
                if result:
                    func_id = result[0]
                    blocks_to_add.append((binary_id, func_id, bb_rva))
            
            if blocks_to_add:
                cov_cur.executemany(
                    f"INSERT OR IGNORE INTO {source_table} (binary_id, func_id, bb_rva) VALUES (?, ?, ?)",
                    blocks_to_add
                )
                total_added += len(blocks_to_add)
                print(f"    Added {len(blocks_to_add)} intermediate blocks")
    
    cov_conn.commit()
    print(f"  Total intermediate blocks added for sample {sample_name}: {total_added}")


def build_executed_graph(cov_conn, master_conn, edges_B_table):
    """
    Build G_B: executed graph restricted to B-covered nodes.
    IMPORTANT: Maps edge endpoints (including return addresses) to their containing BBs.
    """
    print("Step 4: Building executed graph G_B...")

    cov_cur = cov_conn.cursor()
    master_cur = master_conn.cursor()

    # Insert nodes (all B-covered blocks)
    cov_cur.execute("""
        INSERT INTO graph_B_nodes (binary_id, bb_rva, func_id, is_new, in_A)
        SELECT binary_id, bb_rva, func_id, is_new, in_A
        FROM bb_labels
        WHERE in_B = 1
    """)

    # Add super-root node for each binary
    cov_cur.execute("""
        INSERT INTO graph_B_nodes (binary_id, bb_rva, func_id, is_new, in_A)
        SELECT DISTINCT binary_id, -1, -1, 0, 1
        FROM bb_labels
    """)

    # Add super-root edges to all A-covered blocks
    cov_cur.execute("""
        INSERT INTO graph_B_edges (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        SELECT binary_id, -1, bb_rva, 'super_root'
        FROM bb_labels
        WHERE in_A = 1
    """)

    # Create index of B-covered nodes
    cov_cur.execute("SELECT binary_id, bb_rva FROM graph_B_nodes WHERE bb_rva != -1")
    b_nodes = set(cov_cur.fetchall())
    print(f"  Graph has {len(b_nodes)} B-covered nodes")

    # Process each binary separately
    binaries = cov_cur.execute("SELECT DISTINCT binary_id FROM bb_labels").fetchall()
    print(f"  Processing {len(binaries)} binaries...")

    for (binary_id,) in binaries:
        # Add deterministic CFG edges (fallthrough & unconditional branches)
        master_cur.execute("""
            SELECT src_bb_rva, dst_bb_rva, COALESCE(edge_kind, 'cfg') 
            FROM cfg_edges 
            WHERE binary_id = ?
              AND edge_kind IN ('fallthrough', 'branch_unconditional')
        """, (binary_id,))

        cfg_edges = []
        for src, dst, kind in master_cur.fetchall():
            if (binary_id, src) in b_nodes and (binary_id, dst) in b_nodes:
                cfg_edges.append((binary_id, src, dst, f'cfg_{kind}'))

        if cfg_edges:
            cov_cur.executemany(
                "INSERT OR IGNORE INTO graph_B_edges VALUES (?, ?, ?, ?)",
                cfg_edges
            )
        print(f"    Binary {binary_id}: Added {len(cfg_edges)} deterministic CFG edges")

        # Add direct call edges from master.db
        master_cur.execute("""
            SELECT src_bb_rva, dst_func_id 
            FROM call_edges_static 
            WHERE binary_id = ? AND dst_func_id IS NOT NULL
        """, (binary_id,))

        call_edges = []
        for src_rva, dst_func_id in master_cur.fetchall():
            master_cur.execute(
                "SELECT entry_rva FROM functions WHERE binary_id = ? AND func_id = ?", 
                (binary_id, dst_func_id)
            )
            result = master_cur.fetchone()
            if result:
                dst_rva = result[0]
                if (binary_id, src_rva) in b_nodes and (binary_id, dst_rva) in b_nodes:
                    call_edges.append((binary_id, src_rva, dst_rva, 'call_direct'))

        if call_edges:
            cov_cur.executemany(
                "INSERT OR IGNORE INTO graph_B_edges VALUES (?, ?, ?, ?)",
                call_edges
            )
        print(f"    Binary {binary_id}: Added {len(call_edges)} call edges")

    # Add observed edges from coverage B (conditional branches + return address edges)
    # CRITICAL: Map both endpoints to their containing basic blocks
    if edges_B_table:
        cov_cur.execute(f"""
            SELECT m.binary_id, e.src_bb_rva, e.dst_bb_rva
            FROM {edges_B_table} e
            JOIN module_binary_map m ON e.module_id = m.module_id
        """)
        
        observed_edges = []
        mapped_edges = 0
        skipped_edges = 0
        
        for binary_id, src_instruction_rva, dst_instruction_rva in cov_cur.fetchall():
            # Map both endpoints to their containing basic blocks
            src_result = find_containing_basic_block(master_cur, cov_cur, binary_id, src_instruction_rva)
            dst_result = find_containing_basic_block(master_cur, cov_cur, binary_id, dst_instruction_rva)
            
            if src_result and dst_result:
                src_bb_rva, _ = src_result
                dst_bb_rva, _ = dst_result
                
                # Verify both BBs exist in G_B
                if (binary_id, src_bb_rva) in b_nodes and (binary_id, dst_bb_rva) in b_nodes:
                    # Determine edge type based on whether we mapped a return address
                    if src_instruction_rva != src_bb_rva:
                        edge_type = 'observed_return_continuation'
                    else:
                        edge_type = 'observed_conditional'
                    
                    observed_edges.append((binary_id, src_bb_rva, dst_bb_rva, edge_type))
                    mapped_edges += 1
                else:
                    skipped_edges += 1
            else:
                skipped_edges += 1
        
        if observed_edges:
            cov_cur.executemany(
                "INSERT OR IGNORE INTO graph_B_edges VALUES (?, ?, ?, ?)",
                observed_edges
            )
        
        print(f"  Added {len(observed_edges)} observed edges from coverage")
        print(f"    Successfully mapped: {mapped_edges}")
        print(f"    Skipped (endpoints not in G_B): {skipped_edges}")

    # NEW: Add super-root edges to orphaned new blocks (entry points)
    print("  Finding orphaned new blocks (indirect calls, callbacks)...")
    cov_cur.execute("""
        INSERT INTO graph_B_edges (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        SELECT DISTINCT bb.binary_id, -1, bb.bb_rva, 'super_root_orphan'
        FROM bb_labels bb
        WHERE bb.is_new = 1
          AND bb.bb_rva NOT IN (
              -- Exclude blocks that have incoming edges from any block
              SELECT DISTINCT dst_bb_rva 
              FROM graph_B_edges e
              WHERE e.binary_id = bb.binary_id 
                AND e.edge_type != 'super_root'
                AND e.edge_type != 'super_root_orphan'
          )
    """)

    orphan_count = cov_cur.execute("""
        SELECT COUNT(*) FROM graph_B_edges 
        WHERE edge_type = 'super_root_orphan'
    """).fetchone()[0]
    print(f"  Added {orphan_count} super-root edges to orphaned new blocks")

    cov_conn.commit()

    node_count = cov_cur.execute("SELECT COUNT(*) FROM graph_B_nodes").fetchone()[0]
    edge_count = cov_cur.execute("SELECT COUNT(*) FROM graph_B_edges").fetchone()[0]
    print(f"  Built graph with {node_count} nodes and {edge_count} edges")


def identify_frontier(cov_conn):
    """Identify frontier edges and targets."""
    print("Step 5: Identifying frontier edges and classifying...")

    cur = cov_conn.cursor()

    # Find frontier edges: A-covered -> new
    cur.execute("""
        INSERT INTO frontier_edges (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        SELECT e.binary_id, e.src_bb_rva, e.dst_bb_rva, e.edge_type
        FROM graph_B_edges e
        JOIN bb_labels lbl_src ON e.binary_id = lbl_src.binary_id AND e.src_bb_rva = lbl_src.bb_rva
        JOIN bb_labels lbl_dst ON e.binary_id = lbl_dst.binary_id AND e.dst_bb_rva = lbl_dst.bb_rva
        WHERE lbl_src.in_A = 1 AND lbl_dst.is_new = 1
          AND e.edge_type != 'super_root'  -- Only exclude regular super-root, keep orphan edges
    """)
    
    # Also add orphaned new blocks as weak frontiers
    cur.execute("""
        INSERT INTO frontier_edges (binary_id, src_bb_rva, dst_bb_rva, edge_type)
        SELECT binary_id, src_bb_rva, dst_bb_rva, edge_type
        FROM graph_B_edges
        WHERE edge_type = 'super_root_orphan'
    """)

    # Get all unique frontier targets
    cur.execute("""
        SELECT DISTINCT e.binary_id, e.dst_bb_rva, lbl.func_id
        FROM frontier_edges e
        JOIN bb_labels lbl ON e.binary_id = lbl.binary_id AND e.dst_bb_rva = lbl.bb_rva
    """)
    frontier_candidates = cur.fetchall()

    print(f"  Found {len(frontier_candidates)} frontier target candidates")
    print(f"  Classifying as strong (A-only) or weak (A+B)...") 

    strong_count = 0
    weak_count = 0
    frontier_data = []

    for binary_id, bb_rva, func_id in frontier_candidates:
        # Check if this is an orphaned block (only reachable from super-root)
        cur.execute("""
            SELECT COUNT(*)
            FROM graph_B_edges
            WHERE binary_id = ? AND dst_bb_rva = ?
              AND edge_type = 'super_root_orphan'
        """, (binary_id, bb_rva))
        
        if cur.fetchone()[0] > 0:
            # Orphaned blocks are weak frontiers
            frontier_type = 'weak'
            weak_count += 1
        else:
            # Regular frontier classification logic
            cur.execute("""
                SELECT e.src_bb_rva, lbl.in_A, lbl.is_new
                FROM graph_B_edges e
                JOIN bb_labels lbl ON e.binary_id = lbl.binary_id AND e.src_bb_rva = lbl.bb_rva
                WHERE e.binary_id = ? AND e.dst_bb_rva = ?
                  AND e.edge_type NOT LIKE 'super_root%'  -- Exclude super-root edges
            """, (binary_id, bb_rva))

            incoming_edges = cur.fetchall()

            has_a_edge = False
            has_new_edge = False

            for src_rva, in_A, is_new in incoming_edges:
                if in_A == 1:
                    has_a_edge = True
                if is_new == 1:
                    has_new_edge = True

            if has_a_edge and not has_new_edge:
                frontier_type = 'strong'
                strong_count += 1
            else:
                frontier_type = 'weak'
                weak_count += 1

        frontier_data.append((binary_id, bb_rva, func_id, frontier_type))

    cur.executemany(
        "INSERT INTO frontier_targets (binary_id, bb_rva, func_id, frontier_type) VALUES (?, ?, ?, ?)",
        frontier_data
    )

    cov_conn.commit()

    print(f"  Strong frontier targets (A-only): {strong_count}")
    print(f"  Weak frontier targets (A+B): {weak_count}")
    print(f"  Total frontier targets: {len(frontier_data)}")

    return strong_count, weak_count


def compute_reachability(cov_conn):
    """Compute reachability from frontier blocks to all new blocks."""
    print("Step 6: Computing reachability from frontier blocks...")
    
    cur = cov_conn.cursor()
    
    binaries = cur.execute("SELECT DISTINCT binary_id FROM graph_B_nodes").fetchall()
    
    total_reachability_pairs = 0
    
    for (binary_id,) in binaries:
        print(f"  Computing reachability for binary_id={binary_id}...")
        
        # Build adjacency list for G_B
        cur.execute("SELECT src_bb_rva, dst_bb_rva FROM graph_B_edges WHERE binary_id = ?", (binary_id,))
        edges = cur.fetchall()
        
        from collections import deque
        adjacency = defaultdict(list)
        for src, dst in edges:
            adjacency[src].append(dst)
        
        # Get all new blocks
        cur.execute("SELECT bb_rva FROM bb_labels WHERE binary_id = ? AND is_new = 1", (binary_id,))
        new_blocks = set(row[0] for row in cur.fetchall())
        
        # Get frontier targets
        cur.execute("SELECT bb_rva FROM frontier_targets WHERE binary_id = ?", (binary_id,))
        frontier_targets = [row[0] for row in cur.fetchall()]
        
        print(f"    {len(frontier_targets)} frontier targets, {len(new_blocks)} new blocks")
        
        reachability_data = []
        
        for frontier_bb in frontier_targets:
            # BFS from this frontier block
            reachable_new = set()
            visited = set()
            queue = deque([frontier_bb])
            visited.add(frontier_bb)
            
            while queue:
                current = queue.popleft()
                
                if current in new_blocks:
                    reachable_new.add(current)
                
                for neighbor in adjacency[current]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append(neighbor)
            
            for new_bb in reachable_new:
                reachability_data.append((binary_id, frontier_bb, new_bb))
        
        if reachability_data:
            cur.executemany(
                "INSERT OR IGNORE INTO frontier_reachability VALUES (?, ?, ?)",
                reachability_data
            )
            total_reachability_pairs += len(reachability_data)
            print(f"    Stored {len(reachability_data)} reachability pairs")
    
    cov_conn.commit()
    print(f"  Total: {total_reachability_pairs} frontier->new-block reachability pairs")


def compute_attribution(cov_conn):
    """Attribute new coverage to frontier targets."""
    print("Step 7: Computing attribution from reachability...")
    
    cur = cov_conn.cursor()
    
    binaries = cur.execute("SELECT DISTINCT binary_id FROM graph_B_nodes").fetchall()
    
    total_attributed = 0
    
    for (binary_id,) in binaries:
        print(f"  Processing binary_id={binary_id}...")
        
        cur.execute("SELECT bb_rva FROM frontier_targets WHERE binary_id = ?", (binary_id,))
        frontier_targets = [row[0] for row in cur.fetchall()]
        
        cur.execute("SELECT bb_rva, func_id FROM bb_labels WHERE binary_id = ? AND is_new = 1", (binary_id,))
        new_blocks = {row[0]: row[1] for row in cur.fetchall()}
        
        print(f"    {len(frontier_targets)} frontier targets, {len(new_blocks)} new blocks")
        
        new_block_to_frontiers = defaultdict(list)
        
        cur.execute("""
            SELECT frontier_bb_rva, new_bb_rva 
            FROM frontier_reachability 
            WHERE binary_id = ?
        """, (binary_id,))
        
        for frontier_bb, new_bb in cur.fetchall():
            new_block_to_frontiers[new_bb].append(frontier_bb)
        
        frontier_attribution_map = defaultdict(lambda: {'unique': set(), 'shared': set(), 'funcs': set()})
        block_attribution = {}
        
        for new_bb, frontiers in new_block_to_frontiers.items():
            func_id = new_blocks[new_bb]
            
            if len(frontiers) == 1:
                frontier = frontiers[0]
                frontier_attribution_map[frontier]['unique'].add(new_bb)
                frontier_attribution_map[frontier]['funcs'].add(func_id)
                block_attribution[new_bb] = (frontier, 0)
            else:
                for frontier in frontiers:
                    frontier_attribution_map[frontier]['shared'].add(new_bb)
                    frontier_attribution_map[frontier]['funcs'].add(func_id)
                block_attribution[new_bb] = (None, 1)
        
        attr_data = []
        for frontier, data in frontier_attribution_map.items():
            unique_count = len(data['unique'])
            shared_count = len(data['shared'])
            total_count = unique_count + shared_count
            func_count = len(data['funcs'])
            attr_data.append((binary_id, frontier, total_count, unique_count, shared_count, func_count))
        
        if attr_data:
            cur.executemany(
                "INSERT OR REPLACE INTO frontier_attribution VALUES (?, ?, ?, ?, ?, ?)",
                attr_data
            )
        
        block_attr_data = [(binary_id, bb, frontier, is_shared) 
                          for bb, (frontier, is_shared) in block_attribution.items()]
        if block_attr_data:
            cur.executemany(
                "INSERT OR REPLACE INTO bb_attributed_to VALUES (?, ?, ?, ?)",
                block_attr_data
            )
        
        total_attributed += len(block_attr_data)
        print(f"    Attributed {len(block_attr_data)} blocks across {len(frontier_attribution_map)} frontiers")
    
    cov_conn.commit()
    print(f"  Total: Attributed {total_attributed} new blocks to frontier targets")


def aggregate_scores(cov_conn, master_conn):
    """Aggregate attribution scores to functions and callsites."""
    print("Step 8: Aggregating scores...")

    cov_cur = cov_conn.cursor()
    master_cur = master_conn.cursor()

    cov_cur.execute("""
        INSERT INTO function_unlock_scores 
        SELECT 
            bb.binary_id,
            bb.func_id,
            '' as func_name,
            COUNT(DISTINCT CASE WHEN ba.is_shared = 0 THEN ba.new_bb_rva END) as unique_new_bb,
            COUNT(DISTINCT CASE WHEN ba.is_shared = 1 THEN ba.new_bb_rva END) as shared_new_bb,
            COUNT(DISTINCT fr.new_bb_rva) as total_new_bb,
            COUNT(DISTINCT fa.frontier_bb_rva) as frontier_count,
            -- FIX: Use COUNT(DISTINCT ...) instead of SUM()
            COUNT(DISTINCT CASE WHEN ft.frontier_type = 'strong' THEN fa.frontier_bb_rva END) as strong_frontier_count,
            COUNT(DISTINCT CASE WHEN ft.frontier_type = 'weak' THEN fa.frontier_bb_rva END) as weak_frontier_count
        FROM bb_labels bb
        JOIN frontier_attribution fa 
          ON bb.binary_id = fa.binary_id AND bb.bb_rva = fa.frontier_bb_rva
        JOIN frontier_targets ft 
          ON fa.binary_id = ft.binary_id AND fa.frontier_bb_rva = ft.bb_rva
        JOIN frontier_reachability fr 
          ON fa.binary_id = fr.binary_id AND fa.frontier_bb_rva = fr.frontier_bb_rva
        LEFT JOIN bb_attributed_to ba 
          ON fr.binary_id = ba.binary_id AND fr.new_bb_rva = ba.new_bb_rva
        WHERE bb.func_id IS NOT NULL
        GROUP BY bb.binary_id, bb.func_id
    """)

    # Add function names
    cov_cur.execute("SELECT DISTINCT binary_id, func_id FROM function_unlock_scores")
    for binary_id, func_id in cov_cur.fetchall():
        master_cur.execute(
            "SELECT func_name FROM functions WHERE binary_id = ? AND func_id = ?", 
            (binary_id, func_id)
        )
        result = master_cur.fetchone()
        if result:
            cov_cur.execute(
                "UPDATE function_unlock_scores SET func_name = ? WHERE binary_id = ? AND func_id = ?", 
                (result[0], binary_id, func_id)
            )

    # Callsite scores
    cov_cur.execute("""
        INSERT INTO callsite_unlock_scores
        SELECT 
            fe.binary_id,
            fe.src_bb_rva,
            bb_src.func_id as src_func_id,
            NULL as src_func_name,
            bb_dst.func_id as dst_func_id,
            NULL as dst_func_name,
            SUM(fa.unique_new_bb_count) as unique_new_bb,
            SUM(fa.shared_new_bb_count) as shared_new_bb,
            SUM(fa.attributed_new_bb_count) as total_new_bb
        FROM frontier_edges fe
        JOIN frontier_attribution fa 
          ON fe.binary_id = fa.binary_id AND fe.dst_bb_rva = fa.frontier_bb_rva
        JOIN bb_labels bb_src ON fe.binary_id = bb_src.binary_id AND fe.src_bb_rva = bb_src.bb_rva
        JOIN bb_labels bb_dst ON fe.binary_id = bb_dst.binary_id AND fe.dst_bb_rva = bb_dst.bb_rva
        WHERE fe.edge_type NOT LIKE 'super_root%'
        GROUP BY fe.binary_id, fe.src_bb_rva, bb_dst.func_id, bb_src.func_id
    """)

    cov_cur.execute("SELECT DISTINCT binary_id, src_func_id, dst_func_id FROM callsite_unlock_scores")
    for binary_id, src_func_id, dst_func_id in cov_cur.fetchall():
        master_cur.execute(
            "SELECT func_name FROM functions WHERE binary_id = ? AND func_id = ?", 
            (binary_id, src_func_id)
        )
        result = master_cur.fetchone()
        src_name = result[0] if result else None

        if dst_func_id is not None:
            master_cur.execute(
                "SELECT func_name FROM functions WHERE binary_id = ? AND func_id = ?", 
                (binary_id, dst_func_id)
            )
            result = master_cur.fetchone()
            dst_name = result[0] if result else None
        else:
            dst_name = None

        cov_cur.execute(
            """UPDATE callsite_unlock_scores 
               SET src_func_name = ?, dst_func_name = ? 
               WHERE binary_id = ? AND src_func_id = ? AND (dst_func_id IS ? OR (dst_func_id IS NULL AND ? IS NULL))""",
            (src_name, dst_name, binary_id, src_func_id, dst_func_id, dst_func_id)
        )

    cov_conn.commit()

    func_count = cov_cur.execute("SELECT COUNT(*) FROM function_unlock_scores").fetchone()[0]
    call_count = cov_cur.execute("SELECT COUNT(*) FROM callsite_unlock_scores").fetchone()[0]
    print(f"  Generated scores for {func_count} functions and {call_count} callsites")


def print_summary(cov_conn):
    """Print analysis summary."""
    print("\n" + "="*70)
    print("ANALYSIS SUMMARY")
    print("="*70)

    cur = cov_conn.cursor()

    print("\nFrontier Classification:")
    strong_count = cur.execute("SELECT COUNT(*) FROM frontier_targets WHERE frontier_type = 'strong'").fetchone()[0]
    weak_count = cur.execute("SELECT COUNT(*) FROM frontier_targets WHERE frontier_type = 'weak'").fetchone()[0]
    print(f"  Strong frontier blocks (reachable only from A): {strong_count}")
    print(f"  Weak frontier blocks (reachable from A or B): {weak_count}")
    print(f"  Total frontier blocks: {strong_count + weak_count}")

    print("\nTop 10 Functions by New Coverage Unlocked:")
    print(f"{'Rank':<6} {'Function':<35} {'Total':<8} {'Unique':<8} {'Strong':<8} {'Weak':<8}")
    print("-" * 75)

    cur.execute("""
        SELECT func_name, total_new_bb, unique_new_bb, strong_frontier_count, weak_frontier_count
        FROM function_unlock_scores
        ORDER BY total_new_bb DESC
        LIMIT 10
    """)

    for idx, (func_name, total, unique, strong, weak) in enumerate(cur.fetchall(), 1):
        func_display = func_name[:35] if func_name else "<unknown>"
        print(f"{idx:<6} {func_display:<35} {total:<8} {unique:<8} {strong:<8} {weak:<8}")

    print("\nOverall Statistics:")
    total_new = cur.execute("SELECT COUNT(*) FROM bb_labels WHERE is_new = 1").fetchone()[0]
    total_attributed = cur.execute("SELECT COUNT(*) FROM bb_attributed_to").fetchone()[0]
    unique_attributed = cur.execute("SELECT COUNT(*) FROM bb_attributed_to WHERE is_shared = 0").fetchone()[0]
    shared_attributed = cur.execute("SELECT COUNT(*) FROM bb_attributed_to WHERE is_shared = 1").fetchone()[0]

    print(f"  Total new blocks: {total_new}")
    print(f"  Attributed blocks: {total_attributed}")
    print(f"  Uniquely attributed: {unique_attributed}")
    print(f"  Shared attribution: {shared_attributed}")
    print(f"  Unattributed: {total_new - total_attributed}")
    print("="*70 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Analyze coverage differences between two fuzzer samples"
    )
    parser.add_argument("master_db", help="Path to master.db (static analysis)")
    parser.add_argument("cov_db", help="Path to cov_a_b.db (coverage samples)")
    parser.add_argument("--blocks-a", default="cov_A_blocks", help="Coverage A blocks table name")
    parser.add_argument("--blocks-b", default="cov_B_blocks", help="Coverage B blocks table name")
    parser.add_argument("--edges-a", default="cov_A_edges", help="Coverage A edges table name")
    parser.add_argument("--edges-b", default="cov_B_edges", help="Coverage B edges table name")
    parser.add_argument("--missing-output", default="missing_blocks.json", 
                       help="Output file for missing blocks (default: missing_blocks.json)")

    args = parser.parse_args()

    if not Path(args.master_db).exists():
        print(f"Error: Master DB not found: {args.master_db}", file=sys.stderr)
        sys.exit(1)

    if not Path(args.cov_db).exists():
        print(f"Error: Coverage DB not found: {args.cov_db}", file=sys.stderr)
        sys.exit(1)

    print("Coverage Diff Analysis Tool")
    print("="*60)
    print("NOTE: Handles return addresses by mapping to containing BBs")
    print("="*60)

    master_conn = sqlite3.connect(args.master_db)
    cov_conn = sqlite3.connect(args.cov_db)

    # Enable performance optimizations
    cov_conn.execute("PRAGMA journal_mode=WAL")
    cov_conn.execute("PRAGMA synchronous=NORMAL")
    cov_conn.execute("PRAGMA cache_size=10000")
    cov_conn.execute("PRAGMA temp_store=MEMORY")

    try:
        create_analysis_tables(cov_conn)

        mapped_count, unmapped = map_modules_to_binaries(cov_conn, master_conn)

        if mapped_count == 0:
            print("ERROR: No modules could be mapped to binaries!", file=sys.stderr)
            sys.exit(1)

        missing_A = join_coverage_to_blocks(cov_conn, master_conn, "A", args.blocks_a, args.edges_a)
        expand_deterministic_for_sample(cov_conn, master_conn, 'A')

        missing_B = join_coverage_to_blocks(cov_conn, master_conn, "B", args.blocks_b, args.edges_b)
        expand_deterministic_for_sample(cov_conn, master_conn, 'B')

        missing_data = {
            "unmapped_modules": [{"module_id": m[0], "name": m[1], "sha256": m[2]} for m in unmapped],
            "sample_A": missing_A,
            "sample_B": missing_B,
            "total_missing": len(missing_A) + len(missing_B)
        }
        with open(args.missing_output, 'w') as f:
            json.dump(missing_data, f, indent=2)
        print(f"Wrote missing blocks report to {args.missing_output}")

        compute_diff_labels(cov_conn)
        build_executed_graph(cov_conn, master_conn, args.edges_b)
        identify_frontier(cov_conn)
        compute_reachability(cov_conn)
        compute_attribution(cov_conn)
        aggregate_scores(cov_conn, master_conn)

        print_summary(cov_conn)

        print("\nAnalysis complete! Results stored in", args.cov_db)

    except Exception as e:
        print(f"\nError during analysis: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        master_conn.close()
        cov_conn.close()


if __name__ == "__main__":
    main()