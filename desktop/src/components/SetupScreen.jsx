import { useState } from 'react'

function SetupScreen({ onComplete }) {
  const [selectedPath, setSelectedPath] = useState('')
  const [error, setError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  
  const handleSelectFile = async () => {
    try {
      const filePath = await window.api.chooseDataLocation()
      
      if (filePath) {
        setSelectedPath(filePath)
        setError('')
      }
    } catch (err) {
      console.error('Failed to select file:', err)
      setError('Failed to select file: ' + (err.message || 'Unknown error'))
    }
  }

  const handleUseDefault = async () => {
    try {
      const defaultPath = await window.api.getDefaultPath()
      setSelectedPath(defaultPath)
      setError('')
    } catch (err) {
      setError('Failed to get default path: ' + err.message)
    }
  }

  const handleSubmit = async () => {
    if (!selectedPath) {
      setError('Please select a file or folder, or use the default location')
      return
    }

    setIsProcessing(true)
    try {
      // Pass the selected path to the handler
      await onComplete(selectedPath)
    } catch (err) {
      setError('Setup failed: ' + err.message)
      setIsProcessing(false)
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-content">
        <h1>Welcome to Habit Tracker</h1>
        <p className="setup-description">
          Let's set up your data file. All your tasks and history will be stored in a single JSON file 
          that can be synced across devices using Syncthing.
        </p>

        <div className="setup-options">
          <div className="setup-option">
            <button onClick={handleSelectFile} className="option-btn" disabled={isProcessing}>
              Select habit.json Location
            </button>
            <p>Choose where your data file will be stored</p>
          </div>

          <div className="setup-option">
            <button onClick={handleUseDefault} className="option-btn" disabled={isProcessing}>
              Use Default Location
            </button>
            <p>Use the default location next to the app or in Documents</p>
          </div>
        </div>

        {selectedPath && selectedPath !== 'default' && (
          <div className="selected-path">
            <strong>Selected:</strong> {selectedPath}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button 
          onClick={handleSubmit}
          className="continue-btn"
          disabled={!selectedPath || isProcessing}
        >
          {isProcessing ? 'Setting Up...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

export default SetupScreen
