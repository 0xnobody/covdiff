# CovDiff - AI Coding Instructions

## Project Overview
**CovDiff** is a fuzzer coverage diff visualization system with two major components:
- **covdiff-viz**: React/Vite frontend for interactive coverage visualization
- **scripts**: Python backend for coverage analysis and data ingestion

The system analyzes differences in code coverage between two fuzzing campaigns and presents multi-level hierarchical data (modules → functions → basic blocks).

## Architecture

### Frontend (covdiff-viz)
- **Framework**: React 18 with Vite bundler
- **Layout**: FlexLayout for resizable, dockable panels
- **Visualizations**:
  - D3.js treemaps (modules, functions, basic blocks)
  - Cytoscape.js interactive call graph with expandable/collapsible nodes
- **State Management**: React Context API (`AppContext.jsx`) for cross-component selection
- **Key Component Pattern**: Each treemap (Module/Function/BasicBlock) wraps the generic `Treemap` component, passing filters and selection handlers

### Backend (scripts)
- **coverage_analyzer.py**: Main analysis engine - joins coverage data from two SQLite databases and computes diff statistics
- **ingester.py**: FastAPI service that watches campaign directories and exposes REST API for coverage artifacts
- **coverage_parser.py**: Parses raw coverage text files
- **ghidra/**: Java extension for Ghidra to extract control flow graphs to SQLite

### Data Flow
```
Raw Coverage (campaign) → coverage_parser.py → cov_a_b.db
                                               ↓
Ghidra Binary Analysis → ExtractCFGToSQLite.java → master.db
                                                   ↓
                              coverage_analyzer.py → exampleData.js
                                                   ↓
                              React Components render visualization
```

## Critical Developer Knowledge

### Database Schema
**IMPORTANT**: Two separate SQLite databases use different ID spaces:
- **master.db**: Uses `binary_id` for modules, built from Ghidra CFG extraction
- **cov_a_b.db**: Uses `module_id` for modules, built from coverage samples
- **Mapping**: Connected via `module_binary_map` table using `sha256_hash` as the common key

See [coverage_analyzer.py](scripts/coverage_analyzer.py#L6-L8) for the critical note about ID space separation.

### Data Status Values
All entities (modules, functions, basic blocks) use this status enum:
- `'new'`: Only in coverage B (red)
- `'changed'`: Modified between A and B (orange)
- `'unchanged'`: Identical in both (green)

Color scale defined in [Treemap.jsx](src/components/Treemap.jsx#L35-L39).

### Selection/Highlighting Pattern
When a user selects an item:
1. Component calls `setSelectedModule/Function/BasicBlock` from AppContext
2. All treemaps re-render with selection highlighting (blue stroke)
3. Call graph updates to show selection via `setSelectedFunction`/`setSelectedBasicBlock`
4. Parent selection clears child selections (e.g., selecting a module clears function selection)

Example in [ModuleTreemap.jsx](src/components/ModuleTreemap.jsx#L8-L12).

### Call Graph Node Hierarchy
Cytoscape models functions as compound (parent) nodes with basic blocks as children:
- Function nodes are top-level, styled by status
- Basic block nodes nested under function parents
- Expand/collapse uses `cytoscape-expand-collapse` extension
- Edges connect nodes across the module boundary

See [CallGraph.jsx](src/components/CallGraph.jsx#L35-L70) for node/edge construction.

## Development Workflow

### Setup
```bash
cd covdiff-viz
npm install
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # Production build to dist/
npm run preview    # Serve production build locally
```

### Data Integration
1. Replace example data in [src/data/exampleData.js](src/data/exampleData.js) with actual output from `coverage_analyzer.py`
2. Ensure data objects match expected structure:
   - `modules`: `{id, name, size, status}`
   - `functions`: `{id, moduleId, name, size, status}`
   - `basicBlocks`: `{id, functionId, name, status}`
3. Helper functions like `getFunctionsByModule()` filter data by parent ID

### Component Extension Pattern
To add a new visualization:
1. Create component that uses [Treemap.jsx](src/components/Treemap.jsx) or build custom D3/Cytoscape integration
2. Use `useAppContext()` hook to access selection state
3. Add tab to layout model in [App.jsx](src/App.jsx#L12-L64)
4. Register component in layout factory

## Project-Specific Conventions

- **Naming**: Component filenames capitalize the type (ModuleTreemap, CallGraph)
- **IDs**: All entities use string IDs (e.g., `'mod_1'`, `'fn_3'`)
- **D3 Pattern**: Use `ref` for SVG container, `useEffect` to watch data changes and re-render
- **No routing**: Single-page app; all navigation via layout panel selection
- **Error boundary**: AppContext throws if `useAppContext()` called outside provider

## Key Files Reference

| File | Purpose |
|------|---------|
| [src/App.jsx](src/App.jsx) | Layout definition and component routing |
| [src/context/AppContext.jsx](src/context/AppContext.jsx) | Global selection state |
| [src/data/exampleData.js](src/data/exampleData.js) | Data structure + helper filters |
| [src/components/Treemap.jsx](src/components/Treemap.jsx) | Reusable D3 treemap visualization |
| [src/components/CallGraph.jsx](src/components/CallGraph.jsx) | Cytoscape graph with expand/collapse |
| [scripts/coverage_analyzer.py](scripts/coverage_analyzer.py) | Analysis engine; ID mapping logic |
| [scripts/ingester.py](scripts/ingester.py) | Campaign watcher + REST API |

## Integration Notes

- **Frontend uses example data**: Swap `exampleData` for production database queries
- **Backend services**: ingester.py provides REST endpoints; frontend can fetch via `http://localhost:XXXX` in dev
- **Ghidra exports**: ExtractCFGToSQLite.java must run on target binary first to populate master.db
- **No build dependencies on backend**: Frontend builds independently; Python scripts are separate concerns
