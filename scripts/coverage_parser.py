import sqlite3
import re
import argparse
import json
from pathlib import Path

def create_modules_table(db_path, modules_json_path):
    """
    Create modules table and populate it from JSON file.
    
    Args:
        db_path: Path to SQLite database
        modules_json_path: Path to JSON file with module_name: sha256 mapping
    
    Returns:
        dict: Mapping of module_name to module_id
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create modules table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS modules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            sha256_hash TEXT NOT NULL
        )
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_modules_name ON modules(name)")
    
    # Load JSON file
    with open(modules_json_path, 'r') as f:
        modules_data = json.load(f)
    
    # Insert modules
    module_name_to_id = {}
    for module_name, sha256_hash in modules_data.items():
        cursor.execute(
            "INSERT OR IGNORE INTO modules (name, sha256_hash) VALUES (?, ?)",
            (module_name, sha256_hash)
        )
        # Get the module id
        cursor.execute("SELECT id FROM modules WHERE name = ?", (module_name,))
        module_id = cursor.fetchone()[0]
        module_name_to_id[module_name] = module_id
    
    conn.commit()
    print(f"Loaded {len(module_name_to_id)} modules from {modules_json_path}")
    
    conn.close()
    return module_name_to_id

def parse_coverage_file(filepath, db_path, sample_name, module_name_to_id):
    """
    Parse a coverage file and store results in SQLite database.
    
    Args:
        filepath: Path to coverage text file
        db_path: Path to SQLite database
        sample_name: 'a' or 'b' to distinguish samples
        module_name_to_id: Dictionary mapping module names to their IDs
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tables for this sample
    blocks_table = f"cov_{sample_name}_blocks"
    edges_table = f"cov_{sample_name}_edges"
    
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {blocks_table} (
            module_id INTEGER NOT NULL,
            bb_rva INTEGER NOT NULL,
            PRIMARY KEY (module_id, bb_rva),
            FOREIGN KEY (module_id) REFERENCES modules(id)
        )
    """)
    
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {edges_table} (
            module_id INTEGER NOT NULL,
            src_bb_rva INTEGER NOT NULL,
            dst_bb_rva INTEGER NOT NULL,
            PRIMARY KEY (module_id, src_bb_rva, dst_bb_rva),
            FOREIGN KEY (module_id) REFERENCES modules(id)
        )
    """)
    
    # Create indexes for faster queries
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{blocks_table}_module ON {blocks_table}(module_id)")
    cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{edges_table}_module ON {edges_table}(module_id)")
    
    blocks_data = []
    edges_data = []
    unknown_modules = set()
    
    # Parse the file
    pattern = re.compile(r'^(.+?)\+([0-9a-fA-F]+)$')
    
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
                
            match = pattern.match(line)
            if not match:
                print(f"Warning: Could not parse line: {line}")
                continue
            
            module_name = match.group(1)
            value = int(match.group(2), 16)
            
            # Look up module ID
            if module_name not in module_name_to_id:
                if module_name not in unknown_modules:
                    print(f"Warning: Unknown module '{module_name}' - skipping entries for this module")
                    unknown_modules.add(module_name)
                continue
            
            module_id = module_name_to_id[module_name]
            
            # Check if upper 32 bits are nonzero (indirect edge)
            upper_32 = (value >> 32) & 0xFFFFFFFF
            lower_32 = value & 0xFFFFFFFF
            
            if upper_32 != 0:
                # This is an indirect edge
                src_rva = upper_32
                dst_rva = lower_32
                edges_data.append((module_id, src_rva, dst_rva))
            else:
                # This is a basic block hit
                bb_rva = lower_32
                blocks_data.append((module_id, bb_rva))
    
    # Bulk insert
    if blocks_data:
        cursor.executemany(
            f"INSERT OR IGNORE INTO {blocks_table} (module_id, bb_rva) VALUES (?, ?)",
            blocks_data
        )
    
    if edges_data:
        cursor.executemany(
            f"INSERT OR IGNORE INTO {edges_table} (module_id, src_bb_rva, dst_bb_rva) VALUES (?, ?, ?)",
            edges_data
        )
    
    conn.commit()
    
    print(f"Sample {sample_name.upper()} imported:")
    print(f"  - {len(blocks_data)} basic blocks")
    print(f"  - {len(edges_data)} indirect edges")
    if unknown_modules:
        print(f"  - Warning: {len(unknown_modules)} unknown module(s) skipped")
    
    conn.close()

def main():
    """
    Main function to process coverage files A and B.
    """
    parser = argparse.ArgumentParser(
        description='Parse coverage files and store in SQLite database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example usage:
  python coverage_parser.py -a coverage_a.txt -b coverage_b.txt -m modules.json -o coverage.db

Example modules.json format:
  {
    "kernel32.dll": "abc123...",
    "ntdll.dll": "def456...",
    "windows.storage.dll": "789ghi..."
  }

Example queries after import:
  # New blocks in B not in A (with module names):
  SELECT m.name, b.bb_rva 
  FROM cov_b b 
  JOIN modules m ON b.module_id = m.id
  WHERE (b.module_id, b.bb_rva) NOT IN (SELECT module_id, bb_rva FROM cov_a)
  
  # New indirect edges in B not in A:
  SELECT m.name, e.src_bb_rva, e.dst_bb_rva
  FROM cov_indirect_b e
  JOIN modules m ON e.module_id = m.id
  WHERE (e.module_id, e.src_bb_rva, e.dst_bb_rva) NOT IN
    (SELECT module_id, src_bb_rva, dst_bb_rva FROM cov_indirect_a)
        """
    )
    
    parser.add_argument('-a', '--coverage-a', required=True,
                        help='Path to coverage file A')
    parser.add_argument('-b', '--coverage-b', required=True,
                        help='Path to coverage file B')
    parser.add_argument('-m', '--modules', required=True,
                        help='Path to JSON file with module_name: sha256 mapping')
    parser.add_argument('-o', '--output', default='coverage.db',
                        help='Output SQLite database path (default: coverage.db)')
    
    args = parser.parse_args()
    
    # Validate input files exist
    if not Path(args.coverage_a).exists():
        print(f"Error: Coverage file A not found: {args.coverage_a}")
        return 1
    
    if not Path(args.coverage_b).exists():
        print(f"Error: Coverage file B not found: {args.coverage_b}")
        return 1
    
    if not Path(args.modules).exists():
        print(f"Error: Modules JSON file not found: {args.modules}")
        return 1
    
    print(f"Processing coverage files into {args.output}...\n")
    
    # Create modules table and get mapping
    print("Loading modules...")
    module_name_to_id = create_modules_table(args.output, args.modules)
    
    # Parse coverage A
    print(f"\nParsing {args.coverage_a}...")
    parse_coverage_file(args.coverage_a, args.output, 'A', module_name_to_id)
    
    # Parse coverage B
    print(f"\nParsing {args.coverage_b}...")
    parse_coverage_file(args.coverage_b, args.output, 'B', module_name_to_id)
    
    print(f"\n✓ Database created: {args.output}")
    print("\nTables created:")
    print("  - modules (id, name, sha256_hash)")
    print("  - cov_A_blocks, cov_B_blocks (module_id, bb_rva)")
    print("  - cov_A_edges, cov_B_edges (module_id, src_bb_rva, dst_bb_rva)")

if __name__ == "__main__":
    main()
