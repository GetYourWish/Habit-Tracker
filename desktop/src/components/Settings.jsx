import { useState } from 'react'

// Settings — lean habit-app settings: data file, appearance, calendar.
// (The old performance-tracker settings — difficulties, scoring, dashboard
// cards, marker spacing — were removed with the task model.)

function applyTheme(theme) {
  try {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    if (theme === 'system') {
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      if (sysDark) document.documentElement.setAttribute('data-theme', 'dark')
      else document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('pt-theme', theme)
  } catch (e) { /* non-fatal */ }
}

function readStoredTheme() {
  try { return localStorage.getItem('pt-theme') || 'system' } catch (e) { return 'system' }
}

function Settings({ data, onSave, dataFile, conflicts, onBackupNow, onOpenFolder, onChangeDataFolder, autoSync, onToggleAutoSync }) {
  const [activeTab, setActiveTab] = useState('data')
  const [moveStatus, setMoveStatus] = useState(null) // null | 'choosing' | 'confirming' | 'moving'
  const [pendingFolder, setPendingFolder] = useState(null)
  const [error, setError] = useState('')

  const settings = data?.settings || {}
  const theme = settings.theme || readStoredTheme()

  const updateSetting = (key, value) => {
    onSave({
      ...data,
      settings: { ...settings, [key]: value },
      meta: { ...(data?.meta || {}), updatedAt: new Date().toISOString() }
    })
  }

  const handleThemeChange = (value) => {
    applyTheme(value)
    updateSetting('theme', value)
  }

  const handleChangeFolderClick = async () => {
    setMoveStatus('choosing')
    setError('')
    try {
      const folderPath = await window.api.chooseDataLocation()
      if (folderPath) {
        setPendingFolder(folderPath)
        setMoveStatus('confirming')
      } else {
        setMoveStatus(null)
      }
    } catch (err) {
      setError('Failed to select folder: ' + (err.message || err))
      setMoveStatus(null)
    }
  }

  const confirmMove = async () => {
    setMoveStatus('moving')
    setError('')
    try {
      const result = await onChangeDataFolder(pendingFolder)
      if (!result || !result.success) {
        throw new Error(result && result.error ? result.error : 'Move failed')
      }
      setMoveStatus('success')
    } catch (err) {
      setError('Failed to move data: ' + (err.message || err))
      setMoveStatus(null)
    }
  }

  const cancelMove = () => {
    setMoveStatus(null)
    setPendingFolder(null)
    setError('')
  }

  return (
    <div className="settings-container">
      <h2>Settings</h2>

      <div className="settings-tabs">
        <button className={`tab ${activeTab === 'data' ? 'active' : ''}`} onClick={() => setActiveTab('data')}>Data</button>
        <button className={`tab ${activeTab === 'appearance' ? 'active' : ''}`} onClick={() => setActiveTab('appearance')}>Appearance</button>
        <button className={`tab ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}>Calendar</button>
        <button className={`tab ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>About</button>
      </div>

      <div className="settings-content scrollable">
        {activeTab === 'data' && (
          <div className="settings-section">
            <h3>Data File</h3>
            <div className="setting-item">
              <label>Current Data Folder</label>
              <div className="file-path">{dataFile ? dataFile.replace(/[\\/][^\\/]+$/, '') : 'Not set'}</div>
            </div>
            <div className="setting-item">
              <label>Data File</label>
              <div className="file-path" style={{ fontSize: '0.85em', opacity: 0.8 }}>{dataFile || 'Not set'}</div>
            </div>

            <div className="data-actions">
              <button className="action-btn" onClick={onOpenFolder}>Open Data Folder</button>
              <button className="action-btn" onClick={onBackupNow}>Backup Now</button>
              <button className="action-btn" onClick={handleChangeFolderClick} disabled={moveStatus === 'moving'}>
                {moveStatus === 'moving' ? 'Moving…' : 'Change Data Folder'}
              </button>
            </div>

            {moveStatus === 'confirming' && pendingFolder && (
              <div className="folder-confirm-dialog">
                <p><strong>Move your data to:</strong></p>
                <div className="file-path">{pendingFolder}</div>
                <p className="setting-note">
                  A backup will be created first. Your <code>habit.json</code> will be copied to the new folder
                  and the app will switch to using that location.
                </p>
                <div className="data-actions">
                  <button className="action-btn" onClick={confirmMove}>Confirm Move</button>
                  <button className="action-btn" onClick={cancelMove}>Cancel</button>
                </div>
              </div>
            )}

            {moveStatus === 'success' && (
              <div className="folder-move-success">
                Data moved successfully. The new location will take full effect on the next save.
              </div>
            )}

            {error && <div className="error-message" style={{ marginTop: '8px' }}>{error}</div>}

            <div className="setting-item" style={{ marginTop: '16px' }}>
              <label className="sync-toggle-label">
                <span>Auto-Sync File Watching</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={e => onToggleAutoSync(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </label>
              <p className="setting-note">
                Watch habit.json for external changes (e.g. Syncthing) and reload automatically.
              </p>
            </div>

            {conflicts && conflicts.length > 0 && (
              <div className="setting-item">
                <label>⚠️ Sync Conflicts Detected</label>
                <div className="conflict-list">
                  {conflicts.map((c, i) => (
                    <div key={i} className="conflict-item">{c}</div>
                  ))}
                </div>
                <p className="setting-note">
                  Conflict copies were found next to your data file. Resolve them in the folder,
                  then remove the copies.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="setting-item">
              <label>Theme</label>
              <select value={theme} onChange={e => handleThemeChange(e.target.value)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              <p className="setting-note">Light, dark, or follow your OS setting.</p>
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="settings-section">
            <h3>Calendar</h3>
            <div className="setting-item">
              <label>Week Starts On</label>
              <select
                value={settings.weekStartsOn ?? 1}
                onChange={e => updateSetting('weekStartsOn', parseInt(e.target.value, 10))}
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
              <p className="setting-note">Used by streak and weekly-goal math.</p>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="settings-section">
            <h3>About</h3>
            <div className="setting-item">
              <p className="setting-note" style={{ maxWidth: '46ch', lineHeight: 1.6 }}>
                Habit Tracker — a local-first habit app. Everything lives in one
                <code> habit.json</code> you can sync between devices (Syncthing works great).
                Habits can repeat as often as you like — once a day, twice a day with a best
                time for each occurrence, every other day, weekly, monthly…
              </p>
            </div>
            <div className="setting-item">
              <label>Schema Version</label>
              <div className="file-path">{data?.schemaVersion ?? 1}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings
