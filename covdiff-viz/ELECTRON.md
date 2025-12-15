# Electron Development Guide

## Running the App in Development

To run the Electron app with hot reload:

```bash
npm run electron:dev
```

This will:
1. Start the Vite dev server
2. Wait for it to be ready
3. Launch Electron pointing to the dev server
4. Any changes to React code will hot-reload automatically

## Building for Production

### Windows (current platform)
```bash
npm run electron:build
```

This creates a Windows installer in the `release/` directory.

### All Platforms (requires platform-specific tools)
```bash
npm run electron:build:all
```

## Node.js Integration

The app is configured with `nodeIntegration: true` and `contextIsolation: false`, giving you direct access to Node.js APIs in your React components.

### Example: Reading a File

```javascript
import fs from 'fs';
import path from 'path';

// In any React component:
const loadData = () => {
  const filePath = path.join(process.env.HOME, 'coverage.db');
  const data = fs.readFileSync(filePath, 'utf8');
  // Process data...
};
```

### Example: Using Electron APIs

```javascript
const { dialog } = window.require('electron').remote;

// Open file picker
const openFile = async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SQLite', extensions: ['db'] }]
  });
  
  if (!result.canceled) {
    console.log('Selected:', result.filePaths[0]);
  }
};
```

## Project Structure

```
covdiff-viz/
├── electron/
│   └── main.js          # Electron main process
├── src/                 # React app (renderer process)
├── dist/                # Built React app (gitignored)
├── release/             # Electron installers (gitignored)
└── package.json
```

## Adding Features

- **IPC Communication**: Add to `electron/main.js` for renderer ↔ main process communication
- **Custom Menus**: Modify `electron/main.js` to add native menus
- **File Associations**: Update `package.json` build config
- **Auto-updates**: Add electron-updater when ready for distribution
