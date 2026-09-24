const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal IPC API to the renderer process
contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  chooseDataLocation: () => ipcRenderer.invoke('choose-data-location'),
  chooseDataFolder: () => ipcRenderer.invoke('choose-data-folder'),
  moveDataToFolder: (newFolderPath) => ipcRenderer.invoke('move-data-to-folder', { newFolderPath }),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  backupNow: () => ipcRenderer.invoke('backup-now'),
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  setAppState: (state) => ipcRenderer.invoke('set-app-state', state),
  getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
  getCurrentDataPath: () => ipcRenderer.invoke('get-current-data-path'),
  checkConflicts: (filePath) => ipcRenderer.invoke('check-conflicts', { filePath }),
  saveImage: (dataUrl, suggestedName) => ipcRenderer.invoke('save-image', { dataUrl, suggestedName }),
  getIconThemes: () => ipcRenderer.invoke('get-icon-themes'),
  reloadWithIcon: (iconTheme) => ipcRenderer.invoke('reload-with-icon', iconTheme),
  refreshData: () => ipcRenderer.invoke('refresh-data'),
  setWatcherEnabled: (enabled) => ipcRenderer.invoke('set-watcher-enabled', enabled),
  getWatcherEnabled: () => ipcRenderer.invoke('get-watcher-enabled'),
  onExternalChange: (callback) => {
    const listener = (event, payload) => callback({ payload });
    ipcRenderer.on('external-change', listener);
    return () => ipcRenderer.removeListener('external-change', listener);
  }
});
