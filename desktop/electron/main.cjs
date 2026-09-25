const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const chokidar = require('chokidar');

// Global variables
let mainWindow;
let dataFilePath = null;
let watcher = null;
let isExternalWrite = false;
let watcherEnabled = true; // default: auto-sync ON (backward compat)
const FILE_POLL_INTERVAL_MS = 15_000;

// Available icon themes
const ICON_THEMES = ['gradient', 'ember'];

// App state file path
const appStatePath = path.join(app.getPath('userData'), 'app-state.json');

// In-memory caches to avoid repeated disk I/O
let cachedAppState = null;
let cachedIconThemes = null;

// Serialized form of the last known tracker content (load or save).
// Used to skip disk writes when incoming content is identical (anti-churn:
// prevents pointless rewrites and Syncthing sync loops).
let lastSerializedTracker = null;

// Guard: refuse files written by a NEWER app version. Delegates to the shared
// core package — the single authority on schema rules (zero drift principle).
const { checkSchemaVersion } = require('@habit-tracker/core');

function assertLoadableSchema(parsed) {
  const check = checkSchemaVersion(parsed);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = 'SCHEMA_VERSION_TOO_NEW';
    err.schemaVersion = check.schemaVersion;
    throw err;
  }
}

/** Resolve the icon ICO path for a given theme, works in dev and packaged mode. */
function getIconPathForTheme(theme) {
  const fname = `${theme}.ico`;
  if (app.isPackaged) {
    // Primary: extraResources copies build/icons/ → resources/icons/
    const p1 = path.join(process.resourcesPath, 'icons', fname);
    if (fsSync.existsSync(p1)) { console.log(`Icon resolved: ${p1}`); return p1; }
    // Fallback: some builds put resources in a subfolder next to exe
    const p2 = path.join(path.dirname(process.execPath), 'resources', 'icons', fname);
    if (fsSync.existsSync(p2)) { console.log(`Icon resolved (exe-relative): ${p2}`); return p2; }
    // Fallback: flat icon.ico at resources root (guaranteed by extraResources)
    const p3 = path.join(process.resourcesPath, 'icon.ico');
    if (fsSync.existsSync(p3)) { console.log(`Icon resolved (root fallback): ${p3}`); return p3; }
    // Fallback: flat icon.ico next to exe (portable)
    const p4 = path.join(path.dirname(process.execPath), 'icon.ico');
    if (fsSync.existsSync(p4)) { console.log(`Icon resolved (exe-dir): ${p4}`); return p4; }
    console.warn('No icon file found in packaged mode, using built-in');
  }
  // Dev mode: look in build/icons/ first
  const dev = path.join(__dirname, '..', 'build', 'icons', fname);
  if (fsSync.existsSync(dev)) { console.log(`Icon resolved (dev): ${dev}`); return dev; }
  // Ultimate fallback: default icon at build/icon.ico
  const fallback = path.join(__dirname, '..', 'build', 'icon.ico');
  console.log(`Icon resolved (fallback): ${fallback}`);
  return fallback;
}

/** Get the icon path for the user's chosen theme (or default). */
function getAppIconPath(iconTheme) {
  return getIconPathForTheme(iconTheme || 'gradient');
}

/** Read the persisted icon-theme preference (single cached read of app-state.json). */
async function readSavedIconTheme() {
  try {
    const state = cachedAppState || JSON.parse(await fs.readFile(appStatePath, 'utf8').catch(() => '{}'));
    cachedAppState = state;
    if (state.iconTheme && ICON_THEMES.includes(state.iconTheme)) return state.iconTheme;
  } catch (e) {
    console.log('Could not read icon theme from app state:', e.message);
  }
  return null;
}

// Load saved data path or set default - uses SyncThis folder next to executable per spec
async function initializeDataPath() {
  try {
    const stateExists = await fs.access(appStatePath).then(() => true).catch(() => false);
    if (stateExists) {
      const appState = JSON.parse(await fs.readFile(appStatePath, 'utf8'));
      if (appState.dataPath) {
        dataFilePath = appState.dataPath;
        return;
      }
    }
  } catch (e) {
    console.log('Could not load app state, will use default:', e.message);
  }

  // Default location: SyncThis folder next to executable (per spec)
  const exeDir = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  const syncThisDir = path.join(exeDir, 'SyncThis');
  const defaultPath = path.join(syncThisDir, 'habit.json');
  
  // Check if we can write to executable directory
  try {
    await fs.access(exeDir, fs.constants.W_OK);
    // Create SyncThis folder if it doesn't exist
    await fs.mkdir(syncThisDir, { recursive: true });
    dataFilePath = defaultPath;
  } catch (e) {
    // Fallback to Documents folder with SyncThis subfolder
    const documentsPath = app.getPath('documents');
    const fallbackDir = path.join(documentsPath, 'SyncThis');
    await fs.mkdir(fallbackDir, { recursive: true }).catch(() => {});
    dataFilePath = path.join(fallbackDir, 'habit.json');
  }
}

// Save current data path to app state
async function saveDataPath(filePath) {
  if (!filePath) return;
  
  const appState = { dataPath: filePath };
  await fs.writeFile(appStatePath, JSON.stringify(appState, null, 2));
}

// Atomic save using temp file
async function atomicSave(filePath, data) {
  const tempPath = filePath + '.tmp';
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

// Create backups - handles non-existent file gracefully
async function createBackup() {
  if (!dataFilePath) return null;
  
  try {
    // Check if file exists before backing up
    try {
      await fs.access(dataFilePath);
    } catch (e) {
      // File doesn't exist yet, nothing to backup
      return null;
    }
    
    const backupDir = path.join(path.dirname(dataFilePath), '.backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `habit-${timestamp}.json`;
    const backupPath = path.join(backupDir, backupFileName);
    
    await fs.copyFile(dataFilePath, backupPath);
    
    // Clean up old backups (keep ~20 most recent)
    const files = await fs.readdir(backupDir);
    const jsonFiles = files.filter(f => f.startsWith(('habit-') && f.endsWith('.json'))
                          .sort();
    
    if (jsonFiles.length > 20) {
      const toDelete = jsonFiles.slice(0, jsonFiles.length - 20);
      for (const file of toDelete) {
        await fs.unlink(path.join(backupDir, file));
      }
    }
    
    return backupPath;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw error;
  }
}

// Set up file watcher
async function setupWatcher() {
  if (watcher) {
    await watcher.close();
  }
  
  if (!dataFilePath) return;
  
  const dirPath = path.dirname(dataFilePath);
  watcher = chokidar.watch([dirPath], {
    ignoreInitial: true,
    // Synced folders do not reliably forward filesystem events to Electron.
    // Polling ensures changes made by another device are noticed promptly.
    usePolling: true,
    interval: FILE_POLL_INTERVAL_MS,
    ignored: (filePath) => {
      // Ignore temporary files created by our atomic save
      return filePath.includes('.tmp') || 
             filePath.includes('~') ||
             filePath.endsWith('.bak');
    }
  });

  watcher.on('change', async (changedPath) => {
    if (changedPath === dataFilePath && !isExternalWrite) {
      // Guard against sending to a destroyed window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('external-change', changedPath);
      }
    }
  });
}

// Create main window
function createWindow(iconTheme) {
  const iconPath = getAppIconPath(iconTheme);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Load the Vite dev server or built HTML
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Auto-recover from renderer process crashes only.
  // NOTE: Do NOT auto-reload on gpu-process-crashed — the GPU process
  // needs time to restart. An immediate reload races against the GPU
  // recovery, causing a second crash and a permanently blank renderer.
  // The user can manually reload (Ctrl+R) once the GPU process is ready.
  let isReloading = false;
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process crashed:', details);
    if (mainWindow && !mainWindow.isDestroyed() && !isReloading) {
      isReloading = true;
      console.log('Attempting to reload after renderer crash...');
      // Delay reload slightly to avoid racing with GPU process recovery
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
        isReloading = false;
      }, 500);
    }
  });
}

// IPC handlers
ipcMain.handle('load-data', async () => {
  if (!dataFilePath) {
    await initializeDataPath();
  }
  
  try {
    const data = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(data);
    assertLoadableSchema(parsed);
    lastSerializedTracker = JSON.stringify(parsed);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - return null to signal caller to create default data
      lastSerializedTracker = null;
      return null;
    }
    // Corrupt JSON, too-new schema or other error - throw to signal problem
    throw error;
  }
});

// save-data: The renderer already debounces saves (100ms), so we save immediately here.
// No additional debounce needed — avoids double-timer overhead.
// Anti-churn: skip the disk write entirely when content is identical to the
// last known content (no-change-no-write).
ipcMain.handle('save-data', async (event, data) => {
  if (!dataFilePath) {
    await initializeDataPath();
  }
  try {
    const incoming = JSON.stringify(data);
    if (lastSerializedTracker !== null && incoming === lastSerializedTracker) {
      return { skipped: true };
    }
    isExternalWrite = true;
    await atomicSave(dataFilePath, data);
    lastSerializedTracker = incoming;
    isExternalWrite = false;
  } catch (error) {
    isExternalWrite = false;
    console.error('Error during save:', error);
  }
});

ipcMain.handle('choose-data-location', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Choose Data Location',
    defaultPath: dataFilePath || path.join(app.getPath('documents'), 'habit.json'),
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    dataFilePath = result.filePath;
    await saveDataPath(dataFilePath);
    if (watcherEnabled) await setupWatcher();
    return dataFilePath;
  }
  
  return null;
});

// Choose a data folder — opens a native folder picker dialog
ipcMain.handle('choose-data-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Data Folder',
    defaultPath: dataFilePath ? path.dirname(dataFilePath) : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedFolder = result.filePaths[0];
    const newFilePath = path.join(selectedFolder, 'habit.json');
    return { folder: selectedFolder, filePath: newFilePath };
  }

  return null;
});

// Move existing data file to a new folder, keeping backups intact
ipcMain.handle('move-data-to-folder', async (event, { newFolderPath }) => {
  if (!dataFilePath) {
    throw new Error('No current data file to move');
  }

  const newFilePath = path.join(newFolderPath, 'habit.json');

  // If source and destination are the same, nothing to do
  if (path.resolve(dataFilePath) === path.resolve(newFilePath)) {
    return { success: true, filePath: dataFilePath, moved: false };
  }

  try {
    // Create backup before moving
    await createBackup();

    // Copy existing data to new location
    try {
      await fs.access(dataFilePath);
      const fileData = await fs.readFile(dataFilePath, 'utf8');
      await fs.mkdir(newFolderPath, { recursive: true });
      await fs.writeFile(newFilePath, fileData, 'utf8');
    } catch (readErr) {
      // Source file doesn't exist yet — just ensure the new folder exists
      await fs.mkdir(newFolderPath, { recursive: true });
    }

    // Update the active path
    dataFilePath = newFilePath;
    await saveDataPath(dataFilePath);
    if (watcherEnabled) await setupWatcher();

    return { success: true, filePath: dataFilePath, moved: true };
  } catch (error) {
    console.error('Failed to move data:', error);
    throw error;
  }
});

// Get the current data file path (from memory)
ipcMain.handle('get-current-data-path', async () => {
  return dataFilePath;
});

ipcMain.handle('open-data-folder', async () => {
  if (dataFilePath) {
    await shell.openPath(path.dirname(dataFilePath));
  }
});

ipcMain.handle('backup-now', async () => {
  return await createBackup();
});

// Manual refresh: re-read the data file and push to renderer
ipcMain.handle('refresh-data', async () => {
  if (!dataFilePath) {
    await initializeDataPath();
  }
  try {
    const raw = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    assertLoadableSchema(parsed);
    lastSerializedTracker = JSON.stringify(parsed);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
});

// Enable / disable the file watcher at runtime
ipcMain.handle('set-watcher-enabled', async (event, enabled) => {
  watcherEnabled = !!enabled;
  if (watcherEnabled) {
    await setupWatcher();
  } else {
    await stopWatcher();
  }
  return watcherEnabled;
});

// Query current watcher state
ipcMain.handle('get-watcher-enabled', () => {
  return watcherEnabled;
});

ipcMain.handle('get-app-state', async () => {
  // Return cached state if available (written by set-app-state or reload-with-icon)
  if (cachedAppState) return cachedAppState;
  try {
    const stateExists = await fs.access(appStatePath).then(() => true).catch(() => false);
    if (stateExists) {
      cachedAppState = JSON.parse(await fs.readFile(appStatePath, 'utf8'));
      return cachedAppState;
    }
  } catch (e) {
    console.error('Error loading app state:', e);
  }
  return {};
});

ipcMain.handle('set-app-state', async (event, newState) => {
  cachedAppState = { ...cachedAppState, ...newState };
  await fs.writeFile(appStatePath, JSON.stringify(cachedAppState, null, 2));
  if (newState.dataPath) {
    dataFilePath = newState.dataPath;
    if (watcherEnabled) {
      await setupWatcher();
    }
  }
});

// Get default path - returns SyncThis folder next to executable per spec
ipcMain.handle('get-default-path', async () => {
  const exeDir = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  const syncThisDir = path.join(exeDir, 'SyncThis');
  const defaultPath = path.join(syncThisDir, 'habit.json');
  
  try {
    await fs.access(exeDir, fs.constants.W_OK);
    await fs.mkdir(syncThisDir, { recursive: true });
    return defaultPath;
  } catch (e) {
    const documentsPath = app.getPath('documents');
    const fallbackDir = path.join(documentsPath, 'SyncThis');
    await fs.mkdir(fallbackDir, { recursive: true }).catch(() => {});
    return path.join(fallbackDir, 'habit.json');
  }
});

ipcMain.handle('check-conflicts', async (event, { filePath }) => {
  const dirPath = path.dirname(filePath);
  const baseName = path.basename(filePath, '.json');
  
  try {
    const files = await fs.readdir(dirPath);
    const conflictFiles = files.filter(f => 
      f.startsWith(baseName) && 
      f.includes('-conflict-') && 
      f !== path.basename(filePath)
    );
    return conflictFiles.map(f => path.join(dirPath, f));
  } catch (e) {
    return [];
  }
});

// Save a base64-encoded PNG to a user-chosen location
ipcMain.handle('save-image', async (event, { dataUrl, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Image',
    defaultPath: suggestedName || 'working-on.png',
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) return null;

  // Strip the "data:image/png;base64," prefix
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile(result.filePath, Buffer.from(base64Data, 'base64'));
  return result.filePath;
});

// IPC: get available icon themes (cached — paths are static for app lifetime)
ipcMain.handle('get-icon-themes', () => {
  if (cachedIconThemes) return cachedIconThemes;
  cachedIconThemes = ICON_THEMES.map(theme => ({
    id: theme,
    name: theme.charAt(0).toUpperCase() + theme.slice(1),
    preview: getIconPathForTheme(theme).replace('.ico', '.png'),
  }));
  return cachedIconThemes;
});

// IPC: swap the window/taskbar icon to a theme without recreating the window.
ipcMain.handle('set-icon-theme', async (event, iconTheme) => {
  if (!ICON_THEMES.includes(iconTheme)) return { success: false, error: 'Unknown theme' };
  try {
    const state = cachedAppState || JSON.parse(await fs.readFile(appStatePath, 'utf8').catch(() => '{}'));
    state.iconTheme = iconTheme;
    cachedAppState = state;
    await fs.writeFile(appStatePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save icon theme:', e);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(getAppIconPath(iconTheme));
  }
  return { success: true };
});

// IPC: reload the window with a new icon (called after user picks a different icon)
ipcMain.handle('reload-with-icon', async (event, iconTheme) => {
  if (!ICON_THEMES.includes(iconTheme)) return { success: false, error: 'Unknown theme' };
  // Save the icon theme preference to app state (survives data file changes)
  try {
    const state = cachedAppState || JSON.parse(await fs.readFile(appStatePath, 'utf8').catch(() => '{}'));
    state.iconTheme = iconTheme;
    cachedAppState = state;
    await fs.writeFile(appStatePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save icon theme:', e);
  }
  // Recreate the window with the new icon
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();
    mainWindow.close();
    mainWindow = null;
    createWindow(iconTheme);
    if (isMaximized) mainWindow.maximize();
    else if (isFullScreen) mainWindow.setFullScreen(true);
    else mainWindow.setPosition(x, y);
    mainWindow.setSize(w, h);
  } else {
    createWindow(iconTheme);
  }
  return { success: true };
});

// Stop the file watcher (if running)
async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

// Initialize when ready
app.whenReady().then(async () => {
  // Single read of app-state.json — extract both dataPath and iconTheme
  let savedIconTheme = 'gradient';
  try {
    const raw = await fs.readFile(appStatePath, 'utf8').catch(() => '{}');
    const state = JSON.parse(raw);
    cachedAppState = state;
    if (state.dataPath) {
      dataFilePath = state.dataPath;
    }
    if (state.iconTheme && ICON_THEMES.includes(state.iconTheme)) {
      savedIconTheme = state.iconTheme;
    }
    // Restore watcher preference (default: true)
    if (typeof state.watcherEnabled === 'boolean') {
      watcherEnabled = state.watcherEnabled;
    }
  } catch (e) { /* ignore */ }

  // Only call initializeDataPath if we didn't get a path from app-state
  if (!dataFilePath) {
    await initializeDataPath();
  }
  // Only start watcher if the user hasn't opted out
  if (watcherEnabled) {
    await setupWatcher();
  }

  createWindow(savedIconTheme);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(savedIconTheme);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
