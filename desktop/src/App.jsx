import { useState, useEffect, useCallback, useRef } from 'react'
import Board from './components/Board'
import Reviews from './components/Reviews'
import Settings from './components/Settings'
import SetupScreen from './components/SetupScreen'
import { WorkingOnMarker, WorkingOnPopup } from './components/WorkingOnMarker'
import { validateAndHealData, generateId, calculateTaskScoreBreakdown, checkSchemaVersion } from '@habit-tracker/core'
import './App.css'

function App() {
  const [currentView, setCurrentView] = useState('board')
  const [dataFile, setDataFile] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [conflicts, setConflicts] = useState([])
  // selectedDate is managed internally by Reviews — no need to lift it here
  const [showWorkingOnPopup, setShowWorkingOnPopup] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  // Set when the data file was written by a newer app version (schemaVersion > 1)
  const [schemaError, setSchemaError] = useState(null)

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
        console.log('File changed externally:', event.payload)
        await loadData(true) // true = external change, preserve typing
      })
      
      // Check for conflicts on initial load and periodically
      checkForConflicts()
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
      setLoading(false);
      return;
    }
    
    try {
      const loadedData = await window.api.loadData();
      
      // Handle null (file doesn't exist) - shouldn't happen after setup, but be safe
      if (!loadedData) {
        console.warn('Loaded data is null, using default');
        const healedData = validateAndHealData(null);
        setData(healedData);
        setLoading(false);
        return;
      }

      // Refuse files from newer app versions (never heal them downgraded).
      // Primary guard lives in the main process; this is defense in depth.
      const schemaCheck = checkSchemaVersion(loadedData);
      if (!schemaCheck.ok) {
        setSchemaError(schemaCheck.schemaVersion);
        setLoading(false);
        return;
      }
      
      // Validate and heal data on load
      const healedData = validateAndHealData(loadedData);
      lastPersistedRef.current = JSON.stringify(healedData);
      
      // Only update state if data actually changed (for external changes)
      if (isExternalChange && data) {
        // For external changes, we could preserve more state here if needed
        setData(healedData);
      } else {
        setData(healedData);
      }
    } catch (error) {
      const msg = String(error?.message || error);
      const tooNew = msg.match(/SCHEMA_VERSION_TOO_NEW:(\d+)/);
      if (tooNew) {
        setSchemaError(parseInt(tooNew[1], 10));
        setLoading(false);
        return;
      }
      console.error('Failed to load data:', error);
      // Corrupt file or other error - trigger setup to let user choose a new location
      setSetupRequired(true);
    } finally {
      setLoading(false);
    }
  };

  // Debounced save function - does NOT await backup, saves immediately for responsive UI
  const debouncedSave = useCallback((newData) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Store the pending save data
    pendingSaveRef.current = newData;
    
    // Schedule save after 100ms debounce for responsive feel
    saveTimeoutRef.current = setTimeout(async () => {
      if (pendingSaveRef.current && dataFile) {
        try {
          const incoming = JSON.stringify(pendingSaveRef.current);
          // No-change-no-write: identical content must never hit the disk
          if (lastPersistedRef.current === null || incoming !== lastPersistedRef.current) {
            window.api.saveData(pendingSaveRef.current).catch(err => {
              console.error('Failed to save data:', err);
            });
            lastPersistedRef.current = incoming;
          }
          
          // Update UI state immediately for responsive feel
          setData(pendingSaveRef.current);
          pendingSaveRef.current = null;
        } catch (error) {
          console.error('Failed to save data:', error);
          throw error;
        }
      }
    }, 100);
  }, [dataFile]);

  const saveData = useCallback(async (newData) => {
    if (!dataFile) return;
    
    // Use debounced save instead of immediate save
    debouncedSave(newData);
  }, [debouncedSave]);
  
  // Flush pending saves immediately (for when switching views or closing)
  const flushSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    if (pendingSaveRef.current && dataFile) {
      try {
        await window.api.saveData(pendingSaveRef.current);
        
        setData(pendingSaveRef.current);
        pendingSaveRef.current = null;
      } catch (error) {
        console.error('Failed to flush save:', error);
        throw error;
      }
    }
  }, [dataFile]);

  const handleBackupNow = useCallback(async () => {
    try {
      const backupPath = await window.api.backupNow()
      alert(`Backup created at: ${backupPath}`)
    } catch (error) {
      console.error('Failed to create backup:', error)
      alert('Failed to create backup: ' + error.message)
    }
  }, [])

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
      }
    } catch (error) {
      console.error('Refresh failed:', error)
    } finally {
      // Keep the spin animation visible for at least 400ms so it feels intentional
      setTimeout(() => setRefreshing(false), 400)
    }
  }, [refreshing, flushSave])

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
      alert('Failed to open folder: ' + error.message)
    }
  }, [])

  const handleChangeDataFolder = useCallback(async (folderPath) => {
    try {
      const result = await window.api.moveDataToFolder(folderPath)
      if (result && result.filePath) {
        setDataFile(result.filePath)
      }
      return result
    } catch (error) {
      console.error('Failed to move data:', error)
      alert('Failed to move data: ' + error.message)
      throw error
    }
  }, [])

  const handleSetupComplete = async (filePath) => {
    try {
      // Get default path from backend if no specific path selected
      let finalPath = filePath;
      if (!filePath || filePath === 'default') {
        finalPath = await window.api.getDefaultPath();
      }
      
      // Set app state FIRST with the new path - this ensures loadData uses the correct path
      await window.api.setAppState({ dataPath: finalPath });
      setDataFile(finalPath);
      
      // Check if file exists at the NEW path - if not, create default data
      let existingData = null;
      try {
        existingData = await window.api.loadData();
      } catch (e) {
        // File doesn't exist or is invalid, will create new
        existingData = null;
      }
      
      if (!existingData) {
        // Create default data with difficulties if file doesn't exist
        const defaultData = {
          schemaVersion: 1,
          meta: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          settings: {
            theme: 'system',
            weekStartsOn: 1,
            heatmapMode: 'score',
            fatigueIncrement: 0.10,
            fatigueCap: 3.0
          },
          difficulties: [
            { id: generateId(), label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
            { id: generateId(), label: 'Medium', score: 2, color: '#fbbf24', order: 1, active: true },
            { id: generateId(), label: 'Hard', score: 3, color: '#f87171', order: 2, active: true },
            { id: generateId(), label: 'Very Hard', score: 5, color: '#dc2626', order: 3, active: true }
          ],
          categories: [],
          markers: [],
          board: [],
          tasks: []
        };
        await window.api.saveData(defaultData);
      }
      
      // Now load the data from the correct path
      await loadData(finalPath);
      setSetupRequired(false);
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  };

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

  if (setupRequired) {
    return <SetupScreen onComplete={handleSetupComplete} />
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand" title="Habit Tracker — build routines that stick">
          <RecursiveMark size={24} spin />
          <span className="nav-brand-name">Habit<span>Tracker</span></span>
        </div>
        <button 
          className={`nav-item ${currentView === 'board' ? 'active' : ''}`}
          onClick={() => {
            flushSave()
            setCurrentView('board')
          }}
        >
          Board
        </button>
        <button 
          className={`nav-item ${currentView === 'reviews' ? 'active' : ''}`}
          onClick={() => {
            flushSave()
            setCurrentView('reviews')
          }}
        >
          Reviews
        </button>
        <button 
          className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => {
            flushSave()
            setCurrentView('settings')
          }}
        >
          Settings
        </button>
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
        <WorkingOnMarker 
          data={data} 
          onOpenPopup={() => setShowWorkingOnPopup(true)} 
        />
      </nav>
      
      <main className="main-content">
        {currentView === 'board' && (
          <Board data={data} onSave={saveData} />
        )}
        {currentView === 'reviews' && (
          <Reviews 
            data={data} 
            onSave={saveData}
          />
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

      {showWorkingOnPopup && (
        <WorkingOnPopup
          tasks={(data?.workingOn || []).map(id => data?.tasks?.find(t => t.id === id)).filter(Boolean)}
          boardItems={data?.board || []}
          markers={data?.markers || []}
          categories={data?.categories || []}
          difficulties={data?.difficulties || []}
          onClose={() => setShowWorkingOnPopup(false)}
          onCompleteTask={({ taskId, difficultyId, date, note }) => {
            // Find task index in boardItems to determine category based on markers ONLY
            const boardItems = data?.board || []
            const markers = data?.markers || []
            const taskIndex = boardItems.findIndex(item => item.type === 'task' && item.taskId === taskId)
            
            // Strict marker-based category derivation
            let aboveMarker = null
            let belowMarker = null
            
            for (let i = taskIndex - 1; i >= 0; i--) {
              const item = boardItems[i]
              if (item && item.type === 'marker') {
                aboveMarker = item
                break
              }
            }
            
            for (let i = taskIndex + 1; i < boardItems.length; i++) {
              const item = boardItems[i]
              if (item && item.type === 'marker') {
                belowMarker = item
                break
              }
            }
            
            let categoryId = null
            if (aboveMarker && belowMarker && aboveMarker.markerId === belowMarker.markerId) {
              const marker = markers.find(m => m.id === aboveMarker.markerId)
              if (marker) categoryId = marker.categoryId
            } else if (aboveMarker && belowMarker) {
              const aboveMarkerObj = markers.find(m => m.id === aboveMarker.markerId)
              const belowMarkerObj = markers.find(m => m.id === belowMarker.markerId)
              if (aboveMarkerObj && belowMarkerObj && aboveMarkerObj.categoryId === belowMarkerObj.categoryId) {
                categoryId = aboveMarkerObj.categoryId
              }
            }

            const completedAt = new Date().toISOString()

            // Build the completed task object to compute score breakdown
            const completedTask = {
              id: taskId,
              text: data?.tasks?.find(t => t.id === taskId)?.text || '',
              completion: {
                completedDate: date,
                completedAt,
                difficultyId,
                categoryId,
                note: note || ''
              }
            }

            const appDifficulties = data?.difficulties || []
            const appCategories = data?.categories || []
            const appSettings = data?.settings || {}
            const allCompleted = [...(data?.tasks || []).filter(t => t.completion), completedTask]
            const breakdown = calculateTaskScoreBreakdown(
              completedTask,
              allCompleted,
              appDifficulties,
              appSettings.fatigueIncrement || 0.10,
              appSettings.fatigueCap || 3.0,
              appCategories
            )

            // Create log entry
            const logEntry = {
              id: generateId(),
              timestamp: completedAt,
              taskId,
              taskText: completedTask.text,
              difficultyLabel: breakdown.difficultyLabel,
              difficultyColor: breakdown.difficultyColor,
              categoryName: breakdown.categoryName,
              categoryColor: breakdown.categoryColor,
              priorityMultiplier: breakdown.priorityMultiplier,
              fatigueMultiplier: breakdown.fatigueMultiplier,
              basePoints: breakdown.basePoints,
              finalScore: breakdown.finalScore
            }

            const updatedTasks = (data?.tasks || []).map(t => {
              if (t.id === taskId) {
                return {
                  ...t,
                  completion: {
                    completedDate: date,
                    completedAt,
                    difficultyId,
                    categoryId,
                    note: note || ''
                  }
                }
              }
              return t
            })

            const updatedBoard = boardItems.filter(item => 
              !(item.type === 'task' && item.taskId === taskId)
            )
            
            const updatedWorkingOn = (data?.workingOn || []).filter(id => id !== taskId)

            // Cap logs at 500 entries
            const existingLogs = data?.logs || []
            const updatedLogs = existingLogs.length >= 500
              ? [...existingLogs.slice(existingLogs.length - 499), logEntry]
              : [...existingLogs, logEntry]

            saveData({
              ...(data || {}),
              tasks: updatedTasks,
              board: updatedBoard,
              workingOn: updatedWorkingOn,
              logs: updatedLogs,
              meta: { ...(data?.meta || {}), updatedAt: completedAt }
            })

            setShowWorkingOnPopup(false)
          }}
        />
      )}
    </div>
  )
}

export default App
