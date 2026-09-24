import { useState, useMemo } from 'react'

// Dashboard card visibility groups — static config moved to module scope
const DASHBOARD_VIS_GROUPS = [
  {
    group: 'Intensity',
    cards: [
      { id: 'avgDifficulty', label: 'Avg Difficulty' },
      { id: 'pointsPerTask', label: 'Points Per Task' },
      { id: 'intensityTrend', label: 'Intensity Trend' },
      { id: 'trueVsEffort', label: 'True vs Effort' }
    ]
  },
  {
    group: 'Records',
    cards: [
      { id: 'bestPeriods', label: 'Best Periods' },
      { id: 'streaks', label: 'Streaks' },
      { id: 'importantStreak', label: 'Important Streak' },
      { id: 'heaviestLift', label: 'Heaviest Lift' },
      { id: 'balanceDays', label: 'Balance Days' }
    ]
  },
  {
    group: 'Rhythm',
    cards: [
      { id: 'activeDays', label: 'Active Days' },
      { id: 'focusDepth', label: 'Focus Depth' },
      { id: 'weekdayBars', label: 'Weekday Bars' },
      { id: 'shelfTime', label: 'Shelf Time' },
      { id: 'powerHours', label: 'Power Hours' }
    ]
  },
  {
    group: 'Composition',
    cards: [
      { id: 'difficultyMix', label: 'Difficulty Mix' },
      { id: 'categoryDonut', label: 'Category Donut' },
      { id: 'topDifficulty', label: 'Top Difficulty' },
      { id: 'alignment', label: 'Alignment' },
      { id: 'momentum', label: 'Momentum' },
      { id: 'quietNudge', label: 'Quiet Nudge' }
    ]
  }
]

const ICON_PREVIEWS = [
  {
    id: 'gradient',
    name: 'Gradient',
    desc: 'Purple to Cyan',
    colors: ['#8b5cf6', '#22d3ee'],
  },
  {
    id: 'ember',
    name: 'Ember',
    desc: 'Orange to Gold',
    colors: ['#f97316', '#facc15'],
  },
]

function Settings({ data, onSave, dataFile, conflicts, onBackupNow, onOpenFolder, onChangeDataFolder, autoSync, onToggleAutoSync }) {
  const [activeTab, setActiveTab] = useState('data')
  const [moveStatus, setMoveStatus] = useState(null) // null | 'choosing' | 'confirming' | 'moving'
  const [pendingFolder, setPendingFolder] = useState(null)
  const [error, setError] = useState('')
  const [iconSwitching, setIconSwitching] = useState(false)

  const settings = data?.settings || {}
  const difficulties = data?.difficulties || []
  const categories = data?.categories || []
  const logs = data?.logs || []
  const [logFilter, setLogFilter] = useState('all')

  const filteredLogs = useMemo(() => {
    const sorted = [...logs].reverse() // newest first
    if (logFilter === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10)
      return sorted.filter(l => l.timestamp?.slice(0, 10) === todayStr)
    }
    if (logFilter === 'week') {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return sorted.filter(l => new Date(l.timestamp) >= weekAgo)
    }
    return sorted
  }, [logs, logFilter])

  const handleSettingChange = (key, value) => {
    onSave({
      ...data,
      settings: {
        ...settings,
        [key]: value
      },
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleIconSwitch = async (iconId) => {
    const current = settings.appIcon || 'gradient'
    if (iconId === current || iconSwitching) return
    setIconSwitching(true)
    // Save preference to tracker data IMMEDIATELY (bypass debounce)
    // The window will be destroyed by reloadWithIcon, so a debounced save would never flush
    const updatedData = {
      ...data,
      settings: {
        ...settings,
        appIcon: iconId
      },
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    }
    try {
      await window.api.saveData(updatedData)
    } catch (e) {
      console.error('Failed to save icon preference:', e)
    }
    // Tell main process to swap the window icon
    try {
      if (window.api?.reloadWithIcon) {
        await window.api.reloadWithIcon(iconId)
      }
    } catch (e) {
      console.error('Icon switch failed:', e)
    }
    setIconSwitching(false)
  }

  const handleDifficultyUpdate = (index, field, value) => {
    const updated = [...difficulties]
    updated[index] = { ...updated[index], [field]: value }
    onSave({
      ...data,
      difficulties: updated,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleMoveDifficulty = (index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= difficulties.length) return
    
    const updated = [...difficulties]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    
    // Update order values
    updated.forEach((d, i) => {
      d.order = i
    })
    
    onSave({
      ...data,
      difficulties: updated,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleAddDifficulty = () => {
    const newDifficulty = {
      id: `diff-${Date.now()}`,
      label: 'New Difficulty',
      score: 1,
      color: '#60a5fa',
      order: difficulties.length,
      active: true
    }
    onSave({
      ...data,
      difficulties: [...difficulties, newDifficulty],
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleCategoryUpdate = (index, field, value) => {
    const updated = [...categories]
    updated[index] = { ...updated[index], [field]: value }
    onSave({
      ...data,
      categories: updated,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleMoveCategory = (index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= categories.length) return
    
    const updated = [...categories]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    
    // Update order values
    updated.forEach((c, i) => {
      c.order = i
    })
    
    onSave({
      ...data,
      categories: updated,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleAddCategory = () => {
    const newCategory = {
      id: `cat-${Date.now()}`,
      name: 'New Category',
      color: '#60a5fa',
      order: categories.length,
      active: true,
      priorityMultiplier: 1
    }
    onSave({
      ...data,
      categories: [...categories, newCategory],
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }

  const handleChangeFolderClick = async () => {
    setError('')
    setMoveStatus('choosing')
    try {
      const result = await window.api.chooseDataFolder()
      if (result) {
        setPendingFolder(result.folder)
        setMoveStatus('confirming')
      } else {
        setMoveStatus(null)
      }
    } catch (err) {
      setError('Failed to choose folder: ' + (err.message || 'Unknown error'))
      setMoveStatus(null)
    }
  }

  const confirmMove = async () => {
    if (!pendingFolder) return
    setMoveStatus('moving')
    setError('')
    try {
      const result = await onChangeDataFolder(pendingFolder)
      if (result && result.success) {
        setMoveStatus('success')
        setPendingFolder(null)
      }
    } catch (err) {
      setError('Failed to move data: ' + (err.message || 'Unknown error'))
      setMoveStatus(null)
      setPendingFolder(null)
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
        <button 
          className={`tab ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => setActiveTab('data')}
        >
          Data
        </button>
        <button 
          className={`tab ${activeTab === 'difficulties' ? 'active' : ''}`}
          onClick={() => setActiveTab('difficulties')}
        >
          Difficulties
        </button>
        <button 
          className={`tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          Categories
        </button>
        <button 
          className={`tab ${activeTab === 'appearance' ? 'active' : ''}`}
          onClick={() => setActiveTab('appearance')}
        >
          Appearance
        </button>
        <button 
          className={`tab ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setActiveTab('calendar')}
        >
          Calendar
        </button>
        <button 
          className={`tab ${activeTab === 'scoring' ? 'active' : ''}`}
          onClick={() => setActiveTab('scoring')}
        >
          Scoring
        </button>
        <button 
          className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          Logs
        </button>
        <button 
          className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
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
              <button className="action-btn" onClick={onOpenFolder}>
                Open Data Folder
              </button>
              <button className="action-btn" onClick={onBackupNow}>
                Backup Now
              </button>
              <button 
                className="action-btn" 
                onClick={handleChangeFolderClick}
                disabled={moveStatus === 'moving'}
              >
                {moveStatus === 'moving' ? 'Moving…' : 'Change Data Folder'}
              </button>
            </div>

            {/* Folder picker confirmation dialog */}
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

            {/* Success message */}
            {moveStatus === 'success' && (
              <div className="folder-move-success">
                Data moved successfully. The new location will take full effect on the next save.
              </div>
            )}

            {error && <div className="error-message" style={{ marginTop: '8px' }}>{error}</div>}
            
            <div className="setting-item" style={{ marginTop: '16px', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
              <label className="sync-toggle-label">
                <span>Auto-Sync File Watching</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => onToggleAutoSync(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </label>
              <p className="setting-note">
                {autoSync
                  ? 'The app watches the data file for external changes and updates automatically. This uses more CPU resources due to polling.'
                  : 'The app does not watch for external changes. Use the refresh button in the navigation bar to fetch updates manually. This saves CPU resources.'}
              </p>
            </div>

            {conflicts && conflicts.length > 0 && (
              <div className="conflict-warning">
                <strong>Conflict Files Detected:</strong>
                <ul>
                  {conflicts.map((conflict, idx) => (
                    <li key={idx}>{conflict}</li>
                  ))}
                </ul>
                <p className="setting-note">
                  Syncthing has created conflict files. Please review them manually to avoid data loss.
                </p>
              </div>
            )}
            
            <p className="setting-note">
              Choose any folder to store your data. If you use Syncthing, pick your synced folder for automatic cross-device sync.
            </p>
          </div>
        )}

        {activeTab === 'difficulties' && (
          <div className="settings-section">
            <h3>Difficulty Levels</h3>
            <p className="setting-note">
              Changing scores will recalculate all historical data.
            </p>
            
            <div className="difficulties-list">
              {difficulties.map((difficulty, index) => (
                <div key={difficulty.id} className="difficulty-item">
                  <input
                    type="text"
                    value={difficulty.label}
                    onChange={(e) => handleDifficultyUpdate(index, 'label', e.target.value)}
                    placeholder="Label"
                  />
                  <input
                    type="number"
                    value={difficulty.score}
                    onChange={(e) => handleDifficultyUpdate(index, 'score', parseFloat(e.target.value))}
                    step="0.1"
                    min="0"
                    style={{ width: '80px' }}
                  />
                  <input
                    type="color"
                    value={difficulty.color}
                    onChange={(e) => handleDifficultyUpdate(index, 'color', e.target.value)}
                  />
                  <div className="reorder-buttons">
                    <button 
                      className="reorder-btn" 
                      onClick={() => handleMoveDifficulty(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button 
                      className="reorder-btn" 
                      onClick={() => handleMoveDifficulty(index, 1)}
                      disabled={index === difficulties.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={difficulty.active !== false}
                      onChange={(e) => handleDifficultyUpdate(index, 'active', e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              ))}
              
              <button className="add-btn" onClick={handleAddDifficulty}>
                + Add Difficulty
              </button>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="settings-section">
            <h3>Categories</h3>
            <p className="setting-note">
              Set a priority multiplier per category. Tasks in a category with a 2x multiplier
              earn double points. Default is 1.0 (no change).
            </p>
            
            <div className="categories-list">
              {categories.map((category, index) => (
                <div key={category.id} className="category-item">
                  <input
                    type="text"
                    value={category.name}
                    onChange={(e) => handleCategoryUpdate(index, 'name', e.target.value)}
                    placeholder="Name"
                  />
                  <input
                    type="color"
                    value={category.color}
                    onChange={(e) => handleCategoryUpdate(index, 'color', e.target.value)}
                  />
                  <input
                    type="number"
                    value={category.priorityMultiplier ?? 1}
                    onChange={(e) => handleCategoryUpdate(index, 'priorityMultiplier', parseFloat(e.target.value) || 0)}
                    step="0.1"
                    min="0"
                    style={{ width: '70px' }}
                    title="Priority multiplier for scoring (default: 1.0)"
                  />
                  <div className="reorder-buttons">
                    <button 
                      className="reorder-btn" 
                      onClick={() => handleMoveCategory(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button 
                      className="reorder-btn" 
                      onClick={() => handleMoveCategory(index, 1)}
                      disabled={index === categories.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={category.active !== false}
                      onChange={(e) => handleCategoryUpdate(index, 'active', e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              ))}
              
              <button className="add-btn" onClick={handleAddCategory}>
                + Add Category
              </button>
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="settings-section">
            <h3>Appearance</h3>
            
            <div className="setting-item">
              <label>Theme</label>
              <select
                value={settings.theme || 'system'}
                onChange={(e) => handleSettingChange('theme', e.target.value)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            
            <div className="setting-item">
              <label>Multi-Select Modifier</label>
              <select
                value={settings.multiSelectModifier || 'ctrl'}
                onChange={(e) => handleSettingChange('multiSelectModifier', e.target.value)}
              >
                <option value="ctrl">Ctrl (Cmd on macOS)</option>
                <option value="shift">Shift</option>
                <option value="alt">Alt</option>
              </select>
              <p className="setting-note">
                Hold this key while clicking to select multiple items
              </p>
            </div>
            
            <div className="setting-item">
              <label>Consecutive Marker Spacing</label>
              <input
                type="number"
                value={parseInt(settings.consecutiveMarkerMargin) || 150}
                onChange={(e) => handleSettingChange('consecutiveMarkerMargin', `${Math.max(0, parseInt(e.target.value) || 0)}px`)}
                min="0"
                max="500"
                step="10"
                style={{ width: '100px' }}
              />
              <span style={{ marginLeft: '8px', color: 'var(--text-secondary)' }}>px</span>
              <p className="setting-note">
                Space between consecutive category markers on the board (default: 150px)
              </p>
            </div>
            
            <div className="setting-item">
              <label>Flow State Chart Color</label>
              <input
                type="color"
                value={settings.flowStateColor || '#8b5cf6'}
                onChange={(e) => handleSettingChange('flowStateColor', e.target.value)}
                style={{ width: '60px', height: '40px', padding: '2px' }}
              />
              <p className="setting-note">
                Choose the color for the Flow State chart
              </p>
            </div>

            <div className="setting-item">
              <label>App Icon</label>
              <p className="setting-note" style={{ marginBottom: '10px' }}>
                Choose the icon shown in the taskbar and window title.
                The window will briefly refresh to apply the change.
              </p>
              <div className="icon-picker-grid">
                {ICON_PREVIEWS.map((icon) => {
                  const isActive = (settings.appIcon || 'gradient') === icon.id
                  return (
                    <button
                      key={icon.id}
                      className={`icon-picker-card ${isActive ? 'icon-picker-active' : ''}`}
                      onClick={() => handleIconSwitch(icon.id)}
                      disabled={iconSwitching}
                    >
                      <div className="icon-picker-preview" style={{ background: `linear-gradient(135deg, ${icon.colors[0]}, ${icon.colors[1]})` }}>
                        <svg width="40" height="40" viewBox="0 0 256 256" fill="none">
                          <rect x="60" y="150" width="34" height="76" rx="10" fill="white" opacity="0.9"/>
                          <rect x="111" y="108" width="34" height="118" rx="10" fill="white"/>
                          <rect x="162" y="66" width="34" height="160" rx="10" fill="white" opacity="0.85"/>
                        </svg>
                      </div>
                      <div className="icon-picker-label">
                        <span className="icon-picker-name">{icon.name}</span>
                        <span className="icon-picker-desc">{icon.desc}</span>
                      </div>
                      {isActive && <div className="icon-picker-check">&#10003;</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="settings-section">
            <h3>Calendar Settings</h3>
            
            <div className="setting-item">
              <label>Week Starts On</label>
              <select
                value={settings.weekStartsOn || 1}
                onChange={(e) => handleSettingChange('weekStartsOn', parseInt(e.target.value))}
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === 'scoring' && (
          <div className="settings-section">
            <h3>Scoring Settings</h3>
            
            <div className="setting-item">
              <label>Fatigue Bonus Per Task</label>
              <input
                type="number"
                value={settings.fatigueIncrement || 0.10}
                onChange={(e) => handleSettingChange('fatigueIncrement', parseFloat(e.target.value))}
                step="0.01"
                min="0"
                max="1"
              />
              <p className="setting-note">
                Default: 0.10 (10% bonus per additional task)
              </p>
            </div>

            <div className="setting-item">
              <label>Maximum Fatigue Multiplier</label>
              <input
                type="number"
                value={settings.fatigueCap || 3.0}
                onChange={(e) => handleSettingChange('fatigueCap', parseFloat(e.target.value))}
                step="0.1"
                min="1"
                max="10"
              />
              <p className="setting-note">
                Default: 3.0 (maximum 3x score multiplier)
              </p>
            </div>

            <div className="setting-item">
              <label>Heatmap Mode</label>
              <select
                value={settings.heatmapMode || 'score'}
                onChange={(e) => handleSettingChange('heatmapMode', e.target.value)}
              >
                <option value="score">Score</option>
                <option value="count">Task Count</option>
              </select>
            </div>
          </div>
        )}
        {activeTab === 'dashboard' && (
          <div className="settings-section">
            <h3>Dashboard Cards</h3>
            <p className="setting-note">
              Toggle visibility of cards on the Performance Cockpit dashboard.
            </p>
            <div className="dashboard-visibility-groups">
              {DASHBOARD_VIS_GROUPS.map(g => (
                <div key={g.group} className="dash-vis-group">
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{g.group}</h4>
                  {g.cards.map(c => {
                    const dash = settings.dashboard || {}
                    const checked = dash[c.id] !== false
                    return (
                      <label key={c.id} className="dash-vis-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            onSave({
                              ...data,
                              settings: {
                                ...settings,
                                dashboard: { ...settings.dashboard, [c.id]: !checked }
                              },
                              meta: { ...data.meta, updatedAt: new Date().toISOString() }
                            })
                          }}
                        />
                        <span>{c.label}</span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'logs' && (
          <div className="settings-section">
            <div className="logs-header">
              <h3>Completion Logs</h3>
              <div className="logs-actions">
                <select
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="logs-filter-select"
                >
                  <option value="all">All</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                </select>
                <button
                  className="action-btn"
                  onClick={() => {
                    if (window.confirm('Clear all completion logs? This cannot be undone.')) {
                      onSave({
                        ...data,
                        logs: [],
                        meta: { ...data.meta, updatedAt: new Date().toISOString() }
                      })
                    }
                  }}
                  disabled={logs.length === 0}
                >
                  Clear Logs
                </button>
              </div>
            </div>

            <p className="setting-note">
              Each task completion is logged with its full score calculation. Logs are capped at 500 entries.
            </p>

            {filteredLogs.length === 0 ? (
              <div className="logs-empty">No completions logged yet.</div>
            ) : (
              <div className="logs-list">
                {filteredLogs.map(log => (
                  <div key={log.id} className="log-entry">
                    <div className="log-top-row">
                      <span className="log-task-text">{log.taskText}</span>
                      <span className="log-final-score">{log.finalScore} pts</span>
                    </div>
                    <div className="log-meta-row">
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                        {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span
                        className="log-difficulty-chip"
                        style={{
                          backgroundColor: log.difficultyColor + '22',
                          color: log.difficultyColor,
                          borderColor: log.difficultyColor
                        }}
                      >
                        {log.difficultyLabel}
                      </span>
                      {log.categoryName && (
                        <span
                          className="log-category-chip"
                          style={{
                            backgroundColor: log.categoryColor + '22',
                            color: log.categoryColor,
                            borderColor: log.categoryColor
                          }}
                        >
                          {log.categoryName}
                        </span>
                      )}
                    </div>
                    <div className="log-formula-row">
                      <code className="log-formula">
                        {log.basePoints} (base)
                        {log.fatigueMultiplier !== 1 ? ` × ${log.fatigueMultiplier.toFixed(2)} (fatigue)` : ''}
                        {log.priorityMultiplier !== 1 ? ` × ${log.priorityMultiplier.toFixed(1)} (priority)` : ''}
                        {' = '}
                        <strong>{log.finalScore}</strong>
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings
