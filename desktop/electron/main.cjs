const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const chokidar = require('chokidar');

// Global variables
let mainWindow;
let dataFilePath = null;
let watcher = null;
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
const { checkSchemaVersion, validateAndHealData, rebaseSaveOntoFresh } = require('@habit-tracker/core');

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

// Save current data path to app state. MERGES with the existing state —
// overwriting it wholesale used to wipe the iconTheme and watcherEnabled
// preferences every time the data file was moved or re-picked.
async function saveDataPath(filePath) {
  if (!filePath) return;
  try {
    const existing = await readAppStateFile();
    const appState = { ...existing, dataPath: filePath };
    cachedAppState = appState;
    await atomicWriteFile(appStatePath, JSON.stringify(appState, null, 2));
  } catch (e) {
    console.error('Could not persist data path:', e.message);
  }
}

// Read app-state.json as an object ({} when missing/corrupt).
async function readAppStateFile() {
  try {
    return JSON.parse(await fs.readFile(appStatePath, 'utf8').catch(() => '{}'));
  } catch (e) {
    return {};
  }
}

// Atomic write helper — same tmp+rename discipline as the data file, so a
// crash mid-write can never leave a half-written JSON behind.
async function atomicWriteFile(targetPath, content) {
  const tempPath = targetPath + '.tmp';
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, targetPath);
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
    const jsonFiles = files
      .filter((f) => f.startsWith('habit-') && f.endsWith('.json'))
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
  const backupDirName = path.join(dirPath, '.backups');
  watcher = chokidar.watch([dirPath], {
    ignoreInitial: true,
    // Synced folders do not reliably forward filesystem events to Electron.
    // Polling ensures changes made by another device are noticed promptly.
    usePolling: true,
    interval: FILE_POLL_INTERVAL_MS,
    ignored: (filePath) => {
      // Ignore temporary files created by our atomic save (and the mobile
      // app's SAF tmp sibling), editor swap files, and the backup folder —
      // polling 20 backup copies every cycle is pure I/O waste.
      return filePath.includes('.tmp') ||
             filePath.includes('~') ||
             filePath.endsWith('.bak') ||
             filePath === backupDirName ||
             filePath.startsWith(backupDirName + path.sep) ||
             filePath === path.join(dirPath, '.stfolder') || // Syncthing marker
             filePath.startsWith(path.join(dirPath, '.stfolder') + path.sep);
    }
  });

  watcher.on('change', async (changedPath) => {
    if (changedPath !== dataFilePath) return;
    // CONTENT IS THE TRUTH: the old isExternalWrite flag reset long before a
    // polling watcher (interval up to 15 s) delivered our own save back to
    // us, so the app regularly treated its own writes as external changes
    // and reloaded over in-flight user edits. Compare the file's serialized
    // content against the last content this process knows about instead —
    // identical content means the event is our own echo (or a no-op sync
    // rewrite) and is ignored regardless of timing.
    try {
      const raw = await fs.readFile(dataFilePath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // Mid-sync garbage (a sync client streaming blocks into the file).
        // The mobile app settles this case with retries before declaring
        // damage; here the right move is to ignore the event — the next poll
        // delivers the settled content, and a transient read must never kick
        // the user out of their working board.
        return;
      }
      if (JSON.stringify(parsed) === lastSerializedTracker) {
        return; // our own write echoing back — not an external change
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('external-change', changedPath);
      }
    } catch (e) {
      // File vanished mid-read (sync rotation) — the next poll reports the
      // new state. Never surface transient watcher errors.
    }
  });
}

// Create main window
function createWindow(iconTheme) {
  const iconPath = getAppIconPath(iconTheme);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Never squeeze the nav/editor into an unusable strip.
    minWidth: 900,
    minHeight: 600,
    // Matches the light canvas so the very first painted frame (before the
    // renderer applies the saved theme) doesn't flash bright white.
    backgroundColor: '#EEF2FF',
    // Painted-first show: the window only appears once the renderer has its
    // first frame, which includes the inline theme script — dark-theme users
    // no longer get a white flash at every launch.
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Show only after first paint (see `show: false` above).
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
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
//
// Every write goes through core (zero drift): the payload is healed by
// validateAndHealData before it is persisted, and files claiming a newer
// schemaVersion than this app supports are refused — a broken renderer can
// never smuggle unhealed or future-schema data onto disk.
//
// ADDITIVE REBASE (SYNC-DESIGN Option A, core rebaseSaveOntoFresh): when the
// file on disk changed since the last content this process knew (a phone
// write landed inside the watcher's up-to-15s poll latency), the naive
// whole-file write would clobber the phone's check-in. Instead the save's
// additive diff (new completions, new habits/groups, removals) is replayed
// on top of the fresh disk content — both sides' concurrent work survives.
// Failures are REPORTED to the renderer ({ saved: false, error }) — they
// used to be swallowed here, so the UI showed a saved state that never
// reached the disk and the user's changes were silently lost on quit.
ipcMain.handle('save-data', async (event, data) => {
  if (!dataFilePath) {
    await initializeDataPath();
  }
  try {
    const gate = checkSchemaVersion(data);
    if (!gate.ok) {
      return { saved: false, error: gate.message };
    }
    const healed = validateAndHealData(data);
    const incoming = JSON.stringify(healed);
    if (lastSerializedTracker !== null && incoming === lastSerializedTracker) {
      return { skipped: true, saved: true };
    }

    // Rebase when another device wrote the file inside the poll latency.
    let payload = healed;
    let rebased = false;
    try {
      const raw = await fs.readFile(dataFilePath, 'utf8');
      const onDisk = JSON.parse(raw);
      const diskCompact = JSON.stringify(onDisk);
      if (
        lastSerializedTracker !== null &&
        diskCompact !== lastSerializedTracker &&
        onDisk && typeof onDisk === 'object' && !Array.isArray(onDisk)
      ) {
        const diskGate = checkSchemaVersion(onDisk);
        if (!diskGate.ok) {
          // The disk now holds a NEWER-schema file (synced in meanwhile).
          // Never overwrite it — the schema gate owns this file.
          return { saved: false, error: diskGate.message + ' — the file on disk is from a newer app version and was not overwritten.' };
        }
        const fresh = validateAndHealData(onDisk);
        const base = JSON.parse(lastSerializedTracker);
        payload = rebaseSaveOntoFresh(healed, base, fresh);
        rebased = true;
      }
    } catch (e) {
      // Missing/unreadable/unparsable disk content → save as-is (previous
      // behavior). A damaged file is surfaced by the load path; a save here
      // is also how a deliberate recovery overwrite happens.
    }

    await atomicSave(dataFilePath, payload);
    lastSerializedTracker = JSON.stringify(payload);
    return { saved: true, rebased };
  } catch (error) {
    console.error('Error during save:', error);
    return { saved: false, error: error && error.message ? error.message : String(error) };
  }
});

// Choose an existing data file — opens a native OPEN (read) dialog so users
// can point the app at a JSON file that already exists (e.g. synced from
// another device via Syncthing). Previously this used showSaveDialog, which
// only allowed saving/creating a file and never read the picked file back.
ipcMain.handle('choose-data-location', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Data File',
    defaultPath: dataFilePath || path.join(app.getPath('documents'), 'habit.json'),
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];

    // Validate before committing: reject files that aren't loadable JSON so
    // the app doesn't silently overwrite a good file with starter defaults.
    try {
      const raw = await fs.readFile(selectedPath, 'utf8');
      const parsed = JSON.parse(raw);
      assertLoadableSchema(parsed);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Selected file vanished between picking and reading — treat as new.
      } else if (error.code === 'SCHEMA_VERSION_TOO_NEW') {
        throw error;
      } else {
        const err = new Error(`The selected file is not valid habit JSON: ${error.message}`);
        err.cause = error;
        throw err;
      }
    }

    dataFilePath = selectedPath;
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
  await atomicWriteFile(appStatePath, JSON.stringify(cachedAppState, null, 2));
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
    const state = cachedAppState || await readAppStateFile();
    state.iconTheme = iconTheme;
    cachedAppState = state;
    await atomicWriteFile(appStatePath, JSON.stringify(state, null, 2));
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
    const state = cachedAppState || await readAppStateFile();
    state.iconTheme = iconTheme;
    cachedAppState = state;
    await atomicWriteFile(appStatePath, JSON.stringify(state, null, 2));
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
