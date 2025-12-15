#!/usr/bin/env python3
"""
Coverage Visualization Data Exporter
Generates JSON data for interactive coverage diff visualization.
"""

import argparse
import sqlite3
import json
import sys
from pathlib import Path
from collections import defaultdict


def get_block_status(in_A, in_B):
    """
    Convert in_A/in_B flags to status string.
    
    Returns:
        "new": in B but not in A (new coverage)
        "in_A": in A but not in B (lost coverage)
        "in_both": in both A and B (maintained coverage)
    """
    if in_B and not in_A:
        return "new"
    elif in_A and not in_B:
        return "in_A"
    elif in_A and in_B:
        return "in_both"
    else:
        return "neither"  # Should not happen in our data


def get_function_status(blocks_status):
    """
    Determine function status based on its blocks.
    
    Args:
        blocks_status: dict mapping bb_rva -> status
        
    Returns:
        "new": all blocks are new
        "changed": mix of new and old blocks
        "old": no new blocks (all in A or both)
    """
    statuses = set(blocks_status.values())
    
    if "new" in statuses:
        if len(statuses) == 1:
            return "new"
        else:
            return "changed"
    else:
        return "old"


def check_indirectly_called(master_cur, binary_id, func_id):
    """
    Check if a function has no incoming direct call edges from within the same binary.
    This indicates it's likely called indirectly (virtual function, callback, etc.).
    
    Returns:
        True if no direct calls found, False otherwise
    """
    master_cur.execute("""
        SELECT COUNT(*) 
        FROM call_edges_static 
        WHERE binary_id = ? AND dst_func_id = ?
    """, (binary_id, func_id))
    
    result = master_cur.fetchone()
    return result[0] == 0


def export_module_data(master_conn, cov_conn, binary_id):
    """
    Export all data for a single module/binary.
    
    Returns:
        Dictionary with module data in visualization format
    """
    master_cur = master_conn.cursor()
    cov_cur = cov_conn.cursor()
    
    print(f"  Exporting binary_id={binary_id}...")
    
    # Get binary metadata
    master_cur.execute("""
        SELECT binary_name, sha256_hash
        FROM analyzed_binaries
        WHERE binary_id = ?
    """, (binary_id,))
    binary_name, sha256_hash = master_cur.fetchone()
    
    # Get module metadata
    cov_cur.execute("""
        SELECT module_id, module_name
        FROM module_binary_map
        WHERE binary_id = ?
    """, (binary_id,))
    result = cov_cur.fetchone()
    module_id, module_name = result if result else (None, binary_name)
    
    print(f"    Module: {module_name}")
    
    # Get all covered blocks (in A or B)
    cov_cur.execute("""
        SELECT bb_rva, func_id, in_A, in_B, is_new
        FROM bb_labels
        WHERE binary_id = ?
    """, (binary_id,))
    
    covered_blocks = {}
    for bb_rva, func_id, in_A, in_B, is_new in cov_cur.fetchall():
        status = get_block_status(in_A, in_B)
        covered_blocks[bb_rva] = {
            'func_id': func_id,
            'status': status,
            'in_A': in_A,
            'in_B': in_B,
            'is_new': is_new
        }
    
    print(f"    Found {len(covered_blocks)} covered blocks")
    
    # Group blocks by function
    func_blocks = defaultdict(dict)
    for bb_rva, block_data in covered_blocks.items():
        func_id = block_data['func_id']
        func_blocks[func_id][bb_rva] = block_data['status']
    
    # Get all covered functions
    covered_func_ids = set(func_blocks.keys())
    
    # Get block details from master.db
    block_details = {}
    if covered_blocks:
        placeholders = ','.join('?' * len(covered_blocks))
        master_cur.execute(f"""
            SELECT bb_rva, bb_start_va, bb_end_va
            FROM basic_blocks
            WHERE binary_id = ? AND bb_rva IN ({placeholders})
        """, [binary_id] + list(covered_blocks.keys()))
        
        for bb_rva, start_va, end_va in master_cur.fetchall():
            block_details[bb_rva] = {
                'start_va': start_va,
                'end_va': end_va,
                'size': end_va - start_va
            }
    
    # Get frontier information
    cov_cur.execute("""
        SELECT bb_rva, func_id, frontier_type
        FROM frontier_targets
        WHERE binary_id = ?
    """, (binary_id,))
    
    frontier_blocks = {}
    for bb_rva, func_id, frontier_type in cov_cur.fetchall():
        frontier_blocks[bb_rva] = frontier_type
    
    # Get attribution information
    cov_cur.execute("""
        SELECT new_bb_rva, frontier_bb_rva, is_shared
        FROM bb_attributed_to
        WHERE binary_id = ?
    """, (binary_id,))
    
    block_attribution = {}
    for new_bb_rva, frontier_bb_rva, is_shared in cov_cur.fetchall():
        block_attribution[new_bb_rva] = {
            'frontier_bb_rva': frontier_bb_rva,
            'is_shared': bool(is_shared)
        }
    
    # Get function attribution scores
    cov_cur.execute("""
        SELECT func_id, unique_new_bb, shared_new_bb, total_new_bb,
               frontier_count, strong_frontier_count, weak_frontier_count
        FROM function_unlock_scores
        WHERE binary_id = ?
    """, (binary_id,))
    
    func_attribution = {}
    for row in cov_cur.fetchall():
        func_id, unique_bb, shared_bb, total_bb, frontier_count, strong_count, weak_count = row
        func_attribution[func_id] = {
            'total_new_bb': total_bb,
            'unique_new_bb': unique_bb,
            'shared_new_bb': shared_bb,
            'frontier_count': frontier_count,
            'strong_frontier_count': strong_count,
            'weak_frontier_count': weak_count
        }
    
    # Get function details from master.db
    if covered_func_ids:
        placeholders = ','.join('?' * len(covered_func_ids))
        master_cur.execute(f"""
            SELECT func_id, func_name, entry_rva, start_va, end_va, func_size
            FROM functions
            WHERE binary_id = ? AND func_id IN ({placeholders})
        """, [binary_id] + list(covered_func_ids))
        
        functions_data = {}
        for func_id, func_name, entry_rva, start_va, end_va, func_size in master_cur.fetchall():
            # Determine function status
            func_status = get_function_status(func_blocks[func_id])
            
            # Check if indirectly called
            is_indirectly_called = check_indirectly_called(master_cur, binary_id, func_id)
            
            # Build blocks array for this function
            blocks_array = []
            for bb_rva in func_blocks[func_id].keys():
                block_info = covered_blocks[bb_rva]
                details = block_details.get(bb_rva, {'start_va': None, 'end_va': None, 'size': 0})
                
                block_obj = {
                    'bb_rva': hex(bb_rva),
                    'bb_start_va': hex(details['start_va']) if details['start_va'] else None,
                    'bb_end_va': hex(details['end_va']) if details['end_va'] else None,
                    'bb_size': details['size'],
                    'status': block_info['status']
                }
                
                # Add frontier info if applicable
                if bb_rva in frontier_blocks:
                    block_obj['is_frontier'] = True
                    block_obj['frontier_type'] = frontier_blocks[bb_rva]
                else:
                    block_obj['is_frontier'] = False
                    block_obj['frontier_type'] = None
                
                # Add attribution info if applicable
                if bb_rva in block_attribution:
                    attr = block_attribution[bb_rva]
                    block_obj['attribution'] = {
                        'is_attributed': True,
                        'frontier_bb_rva': hex(attr['frontier_bb_rva']) if attr['frontier_bb_rva'] else None,
                        'is_shared': attr['is_shared']
                    }
                else:
                    block_obj['attribution'] = {
                        'is_attributed': False,
                        'frontier_bb_rva': None,
                        'is_shared': False
                    }
                
                blocks_array.append(block_obj)
            
            # Build function object
            func_obj = {
                'func_id': func_id,
                'func_name': func_name,
                'entry_rva': hex(entry_rva),
                'start_va': hex(start_va),
                'end_va': hex(end_va),
                'func_size': func_size,
                'status': func_status,
                'is_indirectly_called': is_indirectly_called,
                'blocks': sorted(blocks_array, key=lambda x: int(x['bb_rva'], 16))
            }
            
            # Add attribution scores if available
            if func_id in func_attribution:
                func_obj['attribution'] = func_attribution[func_id]
            else:
                func_obj['attribution'] = {
                    'total_new_bb': 0,
                    'unique_new_bb': 0,
                    'shared_new_bb': 0,
                    'frontier_count': 0,
                    'strong_frontier_count': 0,
                    'weak_frontier_count': 0
                }
            
            functions_data[func_id] = func_obj
    else:
        functions_data = {}
    
    print(f"    Processed {len(functions_data)} functions")
    
    # Get edges (CFG + call edges) for covered blocks
    edges_array = []
    
    # Get frontier edges
    cov_cur.execute("""
        SELECT src_bb_rva, dst_bb_rva, edge_type
        FROM frontier_edges
        WHERE binary_id = ?
    """, (binary_id,))
    
    frontier_edge_set = set()
    for src, dst, edge_type in cov_cur.fetchall():
        frontier_edge_set.add((src, dst))
    
    # Get all edges in G_B (executed graph)
    cov_cur.execute("""
        SELECT src_bb_rva, dst_bb_rva, edge_type
        FROM graph_B_edges
        WHERE binary_id = ? AND src_bb_rva != -1 AND dst_bb_rva != -1
    """, (binary_id,))
    
    for src_bb_rva, dst_bb_rva, edge_type in cov_cur.fetchall():
        edge_obj = {
            'src_bb_rva': hex(src_bb_rva),
            'dst_bb_rva': hex(dst_bb_rva),
            'edge_type': edge_type,
            'is_frontier_edge': (src_bb_rva, dst_bb_rva) in frontier_edge_set
        }
        edges_array.append(edge_obj)
    
    print(f"    Found {len(edges_array)} edges")
    
    # Calculate module-level statistics
    total_blocks = len(covered_blocks)
    new_blocks = sum(1 for b in covered_blocks.values() if b['status'] == 'new')
    blocks_in_A = sum(1 for b in covered_blocks.values() if b['in_A'])
    blocks_in_B = sum(1 for b in covered_blocks.values() if b['in_B'])
    
    total_functions = len(functions_data)
    new_functions = sum(1 for f in functions_data.values() if f['status'] == 'new')
    changed_functions = sum(1 for f in functions_data.values() if f['status'] == 'changed')
    old_functions = sum(1 for f in functions_data.values() if f['status'] == 'old')
    
    # Determine module status
    if new_functions > 0 or changed_functions > 0:
        if new_functions == total_functions:
            module_status = "new"
        else:
            module_status = "changed"
    else:
        module_status = "old"
    
    # Build module object
    module_obj = {
        'module_id': module_id,
        'binary_id': binary_id,
        'module_name': module_name,
        'binary_name': binary_name,
        'sha256_hash': sha256_hash,
        'status': module_status,
        'statistics': {
            'total_functions': total_functions,
            'new_functions': new_functions,
            'changed_functions': changed_functions,
            'old_functions': old_functions,
            'total_blocks': total_blocks,
            'new_blocks': new_blocks,
            'blocks_in_A': blocks_in_A,
            'blocks_in_B': blocks_in_B
        },
        'functions': sorted(functions_data.values(), key=lambda x: x['func_id']),
        'edges': edges_array
    }
    
    return module_obj


def main():
    parser = argparse.ArgumentParser(
        description="Export coverage diff data to JSON for visualization"
    )
    parser.add_argument("master_db", help="Path to master.db (static analysis)")
    parser.add_argument("cov_db", help="Path to cov_a_b.db (coverage analysis results)")
    parser.add_argument("-o", "--output", default="coverage_viz_data.json",
                       help="Output JSON file (default: coverage_viz_data.json)")
    parser.add_argument("--pretty", action="store_true",
                       help="Pretty-print JSON output")
    
    args = parser.parse_args()
    
    # Validate inputs
    if not Path(args.master_db).exists():
        print(f"Error: Master DB not found: {args.master_db}", file=sys.stderr)
        sys.exit(1)
    
    if not Path(args.cov_db).exists():
        print(f"Error: Coverage DB not found: {args.cov_db}", file=sys.stderr)
        sys.exit(1)
    
    print("Coverage Visualization Data Exporter")
    print("=" * 60)
    
    # Connect to databases
    master_conn = sqlite3.connect(args.master_db)
    cov_conn = sqlite3.connect(args.cov_db)
    
    try:
        cov_cur = cov_conn.cursor()
        
        # Get all analyzed binaries
        cov_cur.execute("SELECT DISTINCT binary_id FROM bb_labels")
        binary_ids = [row[0] for row in cov_cur.fetchall()]
        
        print(f"Found {len(binary_ids)} binaries to export")
        print()
        
        # Export data for each binary
        modules = []
        for binary_id in binary_ids:
            module_data = export_module_data(master_conn, cov_conn, binary_id)
            modules.append(module_data)
        
        # Build final output
        output = {
            'version': '1.0',
            'description': 'Coverage diff visualization data',
            'modules': modules
        }
        
        # Write JSON
        with open(args.output, 'w') as f:
            if args.pretty:
                json.dump(output, f, indent=2)
            else:
                json.dump(output, f)
        
        print()
        print("=" * 60)
        print(f"Export complete!")
        print(f"Output written to: {args.output}")
        print(f"Total modules: {len(modules)}")
        print(f"Total functions: {sum(m['statistics']['total_functions'] for m in modules)}")
        print(f"Total blocks: {sum(m['statistics']['total_blocks'] for m in modules)}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\nError during export: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        master_conn.close()
        cov_conn.close()


if __name__ == "__main__":
    main()
