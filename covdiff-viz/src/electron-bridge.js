/**
 * Electron API bridge
 * Provides access to Electron IPC from the renderer process
 */

// Only initialize in Electron environment
if (typeof window !== 'undefined' && window.require) {
  const { ipcRenderer } = window.require('electron');

  window.electron = {
    // Open file dialog
    openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
    
    // Check if file exists
    fileExists: (filePath) => ipcRenderer.invoke('fs:fileExists', filePath),
    
    // Read file contents
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    
    // Listen for menu events
    onMenuOpenCovdiffFile: (callback) => {
      ipcRenderer.on('menu:openCovdiffFile', callback);
    },
    
    // Remove listeners
    removeMenuOpenCovdiffFile: (callback) => {
      ipcRenderer.removeListener('menu:openCovdiffFile', callback);
    },
    
    // Window controls
    send: (channel, ...args) => {
      ipcRenderer.send(channel, ...args);
    }
  };
} else {
  // Fallback for non-Electron environment (e.g., web browser during development)
  console.warn('Not running in Electron environment, using mock electron API');
  window.electron = {
    openFileDialog: async () => ({ canceled: true, filePaths: [] }),
    fileExists: async () => false,
    readFile: async () => '',
    onMenuOpenCovdiffFile: () => {},
    removeMenuOpenCovdiffFile: () => {},
    send: () => {}
  };
}
