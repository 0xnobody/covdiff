const { ipcMain, dialog } = require('electron');
const fs = require('fs');

/**
 * Setup IPC handlers for file operations
 */
function setupIPC(mainWindow) {
  // Handle file selection dialog
  ipcMain.handle('dialog:openFile', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  // Check if file exists
  ipcMain.handle('fs:fileExists', async (event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  });

  // Read file contents
  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  // Window controls
  ipcMain.on('window-minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow.close();
  });
}

module.exports = { setupIPC };
