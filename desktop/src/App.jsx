import { useState, useEffect, useCallback, useRef } from 'react'
import TodayView from './components/TodayView'
import HabitsView from './components/HabitsView'
import ReviewsView from './components/ReviewsView'
import Settings from './components/Settings'
import SetupScreen from './components/SetupScreen'
import HabitEditor from './components/HabitEditor'
import RecursiveMark from './components/RecursiveMark'
import { validateAndHealData, checkSchemaVersion, createDefaultData } from '@habit-tracker/core'
import { useAppTheme } from './theme'
import './App.css'
import './components/habits.css'

function App() {
  const [currentView, setCurrentView] = useState('today')
  const [dataFile, setDataFile] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [conflicts, setConflicts] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  // Set when the data file was written by a newer app version (schemaVersion > 1)
  const [schemaError, setSchemaError] = useState(null)
  // Set when the data file exists but cannot be read/parsed. NEVER resolved by
  // writing over the file — the old flow bounced the user to Setup, where
  // “use default location” silently overwrote the damaged file with starter
  // defaults. Recovery must be an explicit user action (see README promise).
  const [corruptFile, setCorruptFile] = useState(false)
  // Non-fatal save failure message (disk full, file locked by the sync
  // client, permission lost…). Shown as a banner until the next save works.
  const [saveError, setSaveError] = useState(null)
  // The habit editor (create when habit is null, edit when set)
  const [editorHabit, setEditorHabit] = useState(undefined) // undefined = closed
  // In-app notice (replaces the blocking alert() dialogs — backup results,
  // folder errors). Success notices self-dismiss, errors stay until dismissed.
  const [appNotice, setAppNotice] = useState(null) // { kind: 'success'|'error', text }
  const noticeTimeoutRef = useRef(null)

  // THE theme source is data.settings.theme — the same synced field the
  // mobile app reads. A fresh install (empty localStorage) now starts in the
  // theme the user actually picked on any device, and a theme change made on
  // the phone reaches this desktop on the next sync. Falls back to the
  // localStorage cache until data is available.
  useAppTheme(data?.settings?.theme)

  const showNotice = useCallback((kind, text) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
    setAppNotice({ kind, text })
    // Success notices are confirmations — show, then fade out of the way.
    if (kind === 'success') {
      noticeTimeoutRef.current = setTimeout(() => setAppNotice(null), 5000)
    }
  }, [])

  // Debounce save to avoid constant disk writes
  const saveTimeoutRef = useRef(null)
  const pendingSaveRef = useRef(null)
  // Serialized form of the last content known to be on disk. Saves identical
  // to this are skipped — no-change-no-write (prevents Syncthing churn).
  const lastPersistedRef = useRef(null)

  // Load app state and data file path on mount
  useEffect(() => {
    loadAppState()
  }, [])

  // Sync watcher state from main process on mount
  useEffect(() => {
    window.api.getWatcherEnabled().then(enabled => {
      setAutoSync(enabled)
    }).catch(() => {})
  }, [])

  // Watch for external file changes (only when autoSync is on)
  useEffect(() => {
    if (!dataFile) return
    if (!autoSync) return // no listener when manual mode

    let unsubscribeFn = null

    const setupListener = async () => {
      unsubscribeFn = window.api.onExternalChange(async (event) => {
        // An external write landed while a debounced save was still pending:
        // flush FIRST so the user's in-flight change is on disk and wins the
        // reload, instead of being silently replaced by the incoming content.
        try {
          await flushSave()
        } catch (e) {
          console.error('Flush before external reload failed:', e)
        }
        await loadData(true) // true = external change, preserve typing
        // A Syncthing write often comes with new conflict copies — rescan
        // immediately so the banner is fresh instead of waiting for a
        // restart (the old code scanned only once, on mount).
        checkForConflicts()
      })
    }

    setupListener()

    return () => {
      if (unsubscribeFn) {
        unsubscribeFn()
      }
    }
  }, [dataFile, autoSync])

  // Check for conflict files
  const checkForConflicts = useCallback(async () => {
    if (!dataFile) return

    try {
      const conflictFiles = await window.api.checkConflicts(dataFile)
      if (conflictFiles && conflictFiles.length > 0) {
        setConflicts(conflictFiles)
        console.warn('Conflict files detected:', conflictFiles)
      } else {
        setConflicts([])
      }
    } catch (error) {
      console.error('Failed to check conflicts:', error)
    }
  }, [dataFile])

  // Initial conflict scan — must happen even when auto-sync is OFF (the
  // old code scanned only inside the watcher effect, so manual-mode users
  // never saw conflict copies at all until the first manual refresh).
  useEffect(() => {
    if (dataFile) checkForConflicts()
  }, [dataFile, checkForConflicts])

  const loadAppState = async () => {
    try {
      const appState = await window.api.getAppState()
      if (appState.dataPath) {
        setDataFile(appState.dataPath)
        await loadData(appState.dataPath)
      } else {
        setSetupRequired(true)
        setLoading(false)
      }
    } catch (error) {
      console.error('Failed to load app state:', error)
      setSetupRequired(true)
      setLoading(false)
    }
  }

  const loadData = async (filePath = dataFile, isExternalChange = false) => {
    if (!filePath) {
      setLoading(false)
      return
    }

    try {
      const loadedData = await window.api.loadData()

      // Handle null (file doesn't exist) - shouldn't happen after setup, but be safe
      if (!loadedData) {
        console.warn('Loaded data is null, using default')
        const healedData = validateAndHealData(null)
        setData(healedData)
        setLoading(false)
        return
      }

      // Refuse files from newer app versions (never heal them downgraded).
      // Primary guard lives in the main process; this is defense in depth.
      const schemaCheck = checkSchemaVersion(loadedData)
      if (!schemaCheck.ok) {
        setSchemaError(schemaCheck.schemaVersion)
        setLoading(false)
        return
      }

      // Validate and heal data on load
      const healedData = validateAndHealData(loadedData)
      lastPersistedRef.current = JSON.stringify(healedData)
      setData(healedData)
      setCorruptFile(false)
    } catch (error) {
      const msg = String(error?.message || error)
      const tooNew = msg.match(/SCHEMA_VERSION_TOO_NEW:(\d+)/)
      if (tooNew) {
        setSchemaError(parseInt(tooNew[1], 10))
        setLoading(false)
        return
      }
      console.error('Failed to load data:', error)
      // The file EXISTS but cannot be parsed/read (missing → main returns
      // null, not a throw, so this is genuinely damaged content or an IO
      // error). Offer recovery — never fall through to Setup, whose
      // “create defaults” path would overwrite the damaged file.
      setCorruptFile(true)
    } finally {
      setLoading(false)
    }
  }

  // Debounced save function - does NOT await backup, saves immediately for responsive UI
  const debouncedSave = useCallback((newData) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Store the pending save data
    pendingSaveRef.current = newData

    // Schedule save after 100ms debounce for responsive feel
    saveTimeoutRef.current = setTimeout(async () => {
      if (pendingSaveRef.current && dataFile) {
        try {
          const incoming = JSON.stringify(pendingSaveRef.current)
          let result = null
          // No-change-no-write: identical content must never hit the disk
          if (lastPersistedRef.current === null || incoming !== lastPersistedRef.current) {
            result = await window.api.saveData(pendingSaveRef.current)
            if (result && result.saved === false) {
              // The write FAILED (disk full, file locked, permission…).
              // Never pretend the change was persisted: drop the
              // lastPersisted marker so the next save retries, keep the
              // change pending, and surface a banner so the user knows
              // before quitting.
              setSaveError(result.error || 'The data file could not be written')
              console.error('Failed to save data:', result.error)
              return
            }
            setSaveError(null)
          }
          // Paint the state change (even for a skipped disk write — the
          // content is already on disk and React needs the new object)
          setData(pendingSaveRef.current)
          pendingSaveRef.current = null
          if (result && result.rebased) {
            // The save was MERGED with an external write (a phone change
            // landed inside the watcher's poll latency). Reload NOW so
            // the in-memory state converges with the merged disk content —
            // one more save from this stale view would undo the merge.
            lastPersistedRef.current = null
            await loadData()
            return
          }
          if (result) lastPersistedRef.current = incoming
        } catch (error) {
          setSaveError(error?.message || String(error))
          console.error('Failed to save data:', error)
        }
      }
    }, 100)
  }, [dataFile])

  const saveData = useCallback(async (newData) => {
    if (!dataFile) return
    debouncedSave(newData)
  }, [debouncedSave])

  // Flush pending saves immediately (for when switching views or closing)
  const flushSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    if (pendingSaveRef.current && dataFile) {
      try {
        const incoming = JSON.stringify(pendingSaveRef.current)
        const shouldWrite = lastPersistedRef.current === null || incoming !== lastPersistedRef.current
        const result = shouldWrite
          ? await window.api.saveData(pendingSaveRef.current)
          : { saved: true, skipped: true }
        if (result && result.saved === false) {
          setSaveError(result.error || 'The data file could not be written')
          throw new Error(result.error || 'Save failed')
        }
        setSaveError(null)

        setData(pendingSaveRef.current)
        pendingSaveRef.current = null
        if (result && result.rebased) {
          // Converge with the merged disk content (see debouncedSave).
          lastPersistedRef.current = null
          await loadData()
          return
        }
        lastPersistedRef.current = incoming
      } catch (error) {
        console.error('Failed to flush save:', error)
        throw error
      }
    }
  }, [dataFile])

  const handleBackupNow = useCallback(async () => {
    try {
      const backupPath = await window.api.backupNow()
      showNotice('success', `Backup created: ${backupPath}`)
    } catch (error) {
      console.error('Failed to create backup:', error)
      showNotice('error', 'Backup failed: ' + (error?.message || error))
    }
  }, [showNotice])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await flushSave()
      const loadedData = await window.api.refreshData()
      if (loadedData) {
        const schemaCheck = checkSchemaVersion(loadedData)
        if (!schemaCheck.ok) {
          setSchemaError(schemaCheck.schemaVersion)
          return
        }
        const healedData = validateAndHealData(loadedData)
        lastPersistedRef.current = JSON.stringify(healedData)
        setData(healedData)
        setCorruptFile(false)
      }
      // Manual refresh is also the natural moment to rescan conflict copies.
      checkForConflicts()
    } catch (error) {
      console.error('Refresh failed:', error)
    } finally {
      // Keep the spin animation visible for at least 400ms so it feels intentional
      setTimeout(() => setRefreshing(false), 400)
    }
  }, [refreshing, flushSave, checkForConflicts])

  const handleToggleAutoSync = useCallback(async (enabled) => {
    setAutoSync(enabled)
    try {
      await window.api.setWatcherEnabled(enabled)
      // Persist preference in app-state so it survives restarts
      await window.api.setAppState({ watcherEnabled: enabled })
    } catch (error) {
      console.error('Failed to toggle auto-sync:', error)
    }
  }, [])

  const handleOpenFolder = useCallback(async () => {
    try {
      await window.api.openDataFolder()
    } catch (error) {
      console.error('Failed to open folder:', error)
      showNotice('error', 'Could not open the data folder: ' + (error?.message || error))
    }
  }, [showNotice])

  const handleChangeDataFolder = useCallback(async (folderPath) => {
    try {
      const result = await window.api.moveDataToFolder(folderPath)
      if (result && result.filePath) {
        setDataFile(result.filePath)
      }
      return result
    } catch (error) {
      console.error('Failed to move data:', error)
      showNotice('error', 'Could not move the data folder: ' + (error?.message || error))
      throw error
    }
  }, [showNotice])

  const handleSetupComplete = async (filePath) => {
    try {
      // Get default path from backend if no specific path selected
      let finalPath = filePath
      if (!filePath || filePath === 'default') {
        finalPath = await window.api.getDefaultPath()
      }

      // Set app state FIRST with the new path - this ensures loadData uses the correct path
      await window.api.setAppState({ dataPath: finalPath })
      setDataFile(finalPath)

      // NON-DESTRUCTIVE SEEDING: create starter data ONLY when the chosen
      // location truly has no habit.json. If a file exists but cannot be
      // read (damaged JSON, schema too new, locked), the old code swallowed
      // the error and overwrote the user's file with fresh defaults — the
      // exact “silently overwriting” behavior the README promises never
      // happens. Surface the failure instead and let the user recover.
      let existingData = null
      try {
        existingData = await window.api.loadData()
      } catch (e) {
        const msg = String(e?.message || e)
        if (/SCHEMA_VERSION_TOO_NEW:(\d+)/.test(msg)) {
          setSchemaError(parseInt(msg.match(/SCHEMA_VERSION_TOO_NEW:(\d+)/)[1], 10))
          setLoading(false)
          return
        }
        const err = new Error(
          `A habit.json exists at ${finalPath} but could not be read (${msg}). ` +
          'Nothing was overwritten — open the folder, restore a backup from .backups or fix the file, then try again.'
        )
        err.cause = e
        throw err
      }

      if (!existingData) {
        await window.api.saveData(createDefaultData())
      }

      // Now load the data from the correct path
      await loadData(finalPath)
      setSetupRequired(false)
    } catch (error) {
      console.error('Setup failed:', error)
      throw error
    }
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  if (schemaError !== null) {
    return (
      <div className="loading-screen">
        <h2>Data file is from a newer version</h2>
        <p className="error-message">
          This habit.json uses schemaVersion {schemaError}, but this app supports schemaVersion 1.
        </p>
        <p>The file was not modified. Update this app to a version that supports schema {schemaError}.</p>
      </div>
    )
  }

  if (corruptFile) {
    // NON-DESTRUCTIVE RECOVERY. The file exists but cannot be read. Nothing
    // here writes to it — restoring is the user's explicit decision. The
    // .backups folder beside the data file holds the rolling window, and a
    // damaged original can be copied out by hand from the data folder.
    return (
      <div className="loading-screen">
        <h2>The data file could not be read</h2>
        <p className="error-message">
          {dataFile || 'The data file'} exists, but its content could not be
          loaded (damaged JSON or a read error). <strong>Nothing was modified.</strong>
        </p>
        <p>
          Restore a recent copy from the <code>.backups</code> folder beside the
          data file (or fix the file by hand), then retry. If the file is
          synced, also check the sync client finished transferring it — a
          half-transferred file is unreadable by design until it settles.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button className="btn-happy" onClick={() => window.api.openDataFolder().catch(() => {})}>
            Open data folder
          </button>
          <button
            className="btn-soft"
            onClick={() => {
              setCorruptFile(false)
              setLoading(true)
              loadData()
            }}
          >
            Retry
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              setCorruptFile(false)
              setSetupRequired(true)
            }}
          >
            Choose a different data file
          </button>
        </div>
      </div>
    )
  }

  if (setupRequired) {
    return <SetupScreen onComplete={handleSetupComplete} />
  }

  const openEditor = (habit) => setEditorHabit(habit || null)

  return (
    <div className="app">
      {saveError && (
        <div className="app-banner error" role="alert">
          <div className="app-banner-body">
            <strong>Could not save:</strong> {saveError}
            <span className="app-banner-hint">
              Your changes are still in this window — free the file or disk, then retry.
            </span>
          </div>
          <button
            className="app-banner-action"
            onClick={() => { flushSave().catch(() => {}) }}
          >
            Retry save
          </button>
          <button
            className="app-banner-action ghost"
            aria-label="Dismiss save error"
            onClick={() => setSaveError(null)}
          >
            ✕
          </button>
        </div>
      )}
      {appNotice && (
        <div className={`app-banner ${appNotice.kind}`} role={appNotice.kind === 'error' ? 'alert' : 'status'}>
          <div className="app-banner-body">{appNotice.text}</div>
          <button
            className="app-banner-action ghost"
            aria-label="Dismiss notice"
            onClick={() => {
              if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
              setAppNotice(null)
            }}
          >
            ✕
          </button>
        </div>
      )}
      <nav className="nav">
        <div className="nav-brand" title="Habit Tracker — build routines that stick">
          <RecursiveMark size={24} spin />
          <span className="nav-brand-name">Habit<span>Tracker</span></span>
        </div>
        <button
          className={`nav-item ${currentView === 'today' ? 'active' : ''}`}
          onClick={() => {
            flushSave().catch(() => {})
            setCurrentView('today')
          }}
        >
          Today
        </button>
        <button
          className={`nav-item ${currentView === 'habits' ? 'active' : ''}`}
          onClick={() => {
            flushSave().catch(() => {})
            setCurrentView('habits')
          }}
        >
          Habits
        </button>
        <button
          className={`nav-item ${currentView === 'reviews' ? 'active' : ''}`}
          onClick={() => {
            flushSave().catch(() => {})
            setCurrentView('reviews')
          }}
        >
          Reviews
        </button>
        <button
          className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => {
            flushSave().catch(() => {})
            setCurrentView('settings')
          }}
        >
          Settings
        </button>
        {conflicts.length > 0 && (
          <button
            className="nav-item nav-conflicts"
            onClick={() => {
              flushSave().catch(() => {})
              setCurrentView('settings')
            }}
            title="Sync conflict copies were found next to your data file — review them in Settings → Data"
            aria-label={`${conflicts.length} sync conflict${conflicts.length > 1 ? 's' : ''} detected. Open Settings to review.`}
          >
            ⚠ {conflicts.length}
          </button>
        )}
        <button
          className={`nav-refresh-btn ${refreshing ? 'spinning' : ''}`}
          onClick={handleRefresh}
          title={autoSync ? 'Refresh data' : 'Refresh data (auto-sync is off)'}
          aria-label="Refresh data"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13.65 2.35A7.96 7.96 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 8 14 6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" fill="currentColor"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}></div>
        <button
          className="nav-item"
          style={{ fontWeight: 800 }}
          onClick={() => openEditor(null)}
          title="New habit (creates a habit you can check off each day)"
        >
          ＋ Habit
        </button>
      </nav>

      <main className="main-content">
        {currentView === 'today' && (
          <TodayView
            data={data}
            onSave={saveData}
            onEditHabit={openEditor}
            onAddHabit={() => openEditor(null)}
          />
        )}
        {currentView === 'habits' && (
          <HabitsView
            data={data}
            onSave={saveData}
            onEditHabit={openEditor}
            onAddHabit={() => openEditor(null)}
          />
        )}
        {currentView === 'reviews' && (
          <ReviewsView data={data} />
        )}
        {currentView === 'settings' && (
          <Settings
            data={data}
            onSave={saveData}
            dataFile={dataFile}
            conflicts={conflicts}
            onBackupNow={handleBackupNow}
            onOpenFolder={handleOpenFolder}
            onChangeDataFolder={handleChangeDataFolder}
            autoSync={autoSync}
            onToggleAutoSync={handleToggleAutoSync}
          />
        )}
      </main>

      {editorHabit !== undefined && (
        <HabitEditor
          key={editorHabit ? editorHabit.id : 'new'}
          data={data}
          onSave={saveData}
          onClose={() => setEditorHabit(undefined)}
          habit={editorHabit}
          onArchive={(habit) => {
            saveData({
              ...data,
              habits: (data.habits || []).map(h => (h.id === habit.id ? { ...h, archived: !h.archived } : h)),
              meta: { ...(data.meta || {}), updatedAt: new Date().toISOString() }
            })
          }}
          onDelete={(habit) => {
            saveData({
              ...data,
              habits: (data.habits || []).filter(h => h.id !== habit.id),
              board: (data.board || []).filter(item => !(item && item.type === 'habit' && item.habitId === habit.id)),
              completions: (data.completions || []).filter(c => c.habitId !== habit.id),
              meta: { ...(data.meta || {}), updatedAt: new Date().toISOString() }
            })
          }}
        />
      )}
    </div>
  )
}

export default App
