# Fuzzer Coverage Dashboard

An interactive visualization dashboard for fuzzer coverage diff data, built with React, D3.js, and Cytoscape.js.

## Features

- **Three Interactive Treemaps**: Visualize modules, functions, and basic blocks with color-coded status indicators
- **Call Graph Visualization**: Interactive graph showing function and basic block relationships with expandable/collapsible nodes
- **Resizable Layout**: Dockable, resizable panels using flexlayout-react
- **Bidirectional Selection**: Click items in treemaps to highlight in graph and vice versa
- **Detail Pane**: View detailed information about selected items

## Color Coding

- 🔴 **Red**: New in coverage B
- 🟠 **Orange**: Changed in coverage B (some underlying elements modified)
- 🟢 **Green**: Unchanged between A and B

## Setup

1. **Extract the zip file**:
   ```bash
   unzip fuzzer-coverage-dashboard.zip
   cd fuzzer-coverage-dashboard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser** to the URL shown (usually http://localhost:5173)

## Project Structure

```
fuzzer-coverage-dashboard/
├── index.html                   # HTML entry point
├── package.json                 # Dependencies
├── vite.config.js              # Vite configuration
├── .gitignore
└── src/
    ├── main.jsx                # React entry point
    ├── index.css               # Global styles
    ├── App.jsx                 # Main layout
    ├── components/
    │   ├── Treemap.jsx         # Base treemap (reusable)
    │   ├── ModuleTreemap.jsx
    │   ├── FunctionTreemap.jsx
    │   ├── BasicBlockTreemap.jsx
    │   ├── CallGraph.jsx       # Cytoscape graph
    │   └── DetailPane.jsx
    ├── context/
    │   └── AppContext.jsx      # State management
    └── data/
        └── exampleData.js      # REPLACE WITH YOUR DATA
```

## Usage

1. **Select a module** in the top-left treemap
2. **Select a function** in the middle-left treemap
3. **Select a basic block** in the bottom-left treemap
4. The **call graph** shows the selected module's functions and basic blocks
5. **Click function nodes** in the graph to expand/collapse basic blocks
6. The **detail pane** shows information about your selection

## Integrating Your SQLite Data

### Required Data Structure

Your data must follow this format in `src/data/exampleData.js`:

```javascript
export const exampleData = {
  modules: [
    { id: 'unique_id', name: 'display_name', size: 1024, status: 'new' }
  ],
  functions: [
    { id: 'unique_id', moduleId: 'parent_module_id', name: 'func_name', size: 512, status: 'changed' }
  ],
  basicBlocks: [
    { id: 'unique_id', functionId: 'parent_function_id', name: 'BB_0x1000', size: 128, status: 'unchanged' }
  ],
  edges: [
    { source: 'bb_id_1', target: 'bb_id_2' }
  ]
};
```

### Required Fields

- **id**: Unique identifier (string)
- **name**: Display name (string)
- **size**: Size in bytes (number) - used for treemap sizing
- **status**: One of 'new', 'changed', 'unchanged' (string)
- **moduleId**: For functions - links to parent module
- **functionId**: For basic blocks - links to parent function

### Adding Custom Fields

Add any additional fields to your data objects:

```javascript
{
  id: 'fn_1',
  name: 'encrypt',
  size: 4096,
  status: 'changed',
  // Custom fields:
  address: '0x400000',
  coveragePercent: 85.5,
  executionCount: 1523,
  // ... any other fields
}
```

These are accessible in components via `data.rawData` and can be displayed in the DetailPane.

### Method 1: Direct JSON Export

1. Export your SQLite data to JSON matching the above structure
2. Replace the contents of `src/data/exampleData.js`
3. Keep the helper functions at the bottom of the file

### Method 2: Python Backend API

Create a Flask/FastAPI server:

```python
from flask import Flask, jsonify
import sqlite3

app = Flask(__name__)

@app.route('/api/coverage-data')
def get_coverage_data():
    conn = sqlite3.connect('your_database.db')
    # Query and format your data
    data = {
        'modules': [...],
        'functions': [...],
        'basicBlocks': [...],
        'edges': [...]
    }
    return jsonify(data)

if __name__ == '__main__':
    app.run(port=5000)
```

Then create `src/data/dataLoader.js`:

```javascript
export const loadDataFromBackend = async () => {
  const response = await fetch('http://localhost:5000/api/coverage-data');
  return await response.json();
};
```

Modify `src/data/exampleData.js` to use it:

```javascript
import { loadDataFromBackend } from './dataLoader';

export let exampleData = {
  modules: [],
  functions: [],
  basicBlocks: [],
  edges: []
};

// Load data on import
loadDataFromBackend().then(data => {
  Object.assign(exampleData, data);
});
```

## Customization

### Adding Custom Detail Fields

Edit `src/components/DetailPane.jsx`:

```javascript
<DetailRow label="Your Field" value={selectedFunction.yourCustomField} />
<DetailRow label="Coverage %" value={`${selectedFunction.coveragePercent}%`} />
```

### Changing Colors

Edit `src/components/Treemap.jsx`:

```javascript
const colorScale = {
  'new': '#your-hex-color',
  'changed': '#your-hex-color',
  'unchanged': '#your-hex-color'
};
```

### Adjusting Graph Layout

Edit `src/components/CallGraph.jsx`:

```javascript
layout: {
  name: 'cose',  // or 'breadthfirst', 'circle', 'grid', 'concentric'
  // ... layout-specific options
}
```

Available layouts: breadthfirst, cose, circle, grid, concentric, preset

## Building for Production

```bash
npm run build
```

Output will be in `dist/` folder. Deploy with any static hosting service.

## Technologies

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **flexlayout-react** - Resizable panel layout
- **D3.js** - Treemap visualization
- **Cytoscape.js** - Graph visualization
- **cytoscape-expand-collapse** - Collapsible graph nodes

## Troubleshooting

### Dev server won't start
- Make sure Node.js 16+ is installed: `node --version`
- Delete `node_modules` and run `npm install` again
- Check if port 5173 is already in use

### Treemaps not showing
- Verify your data has the `size` field (used for treemap sizing)
- Check browser console for errors

### Graph not displaying
- Ensure edges reference valid basic block IDs
- Check that moduleId and functionId relationships are correct

### Custom fields not showing
- Make sure you're accessing via `data.rawData.yourField`
- Add DetailRow components in DetailPane.jsx

## License

MIT
