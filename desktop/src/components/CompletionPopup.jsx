import { useState, useCallback } from 'react'
import { getCurrentDate } from '@habit-tracker/core'

function CompletionPopup({ task, difficulties, onConfirm, onCancel }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(null)
  const [date, setDate] = useState(getCurrentDate())
  const [note, setNote] = useState('')
  
  const activeDifficulties = difficulties.filter(d => d.active !== false)
  
  const handleConfirm = useCallback(() => {
    if (!selectedDifficulty) return

    onConfirm({
      taskId: task.id,
      difficultyId: selectedDifficulty,
      date,
      note
    })
  }, [selectedDifficulty, date, note, task.id, onConfirm])
  
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && selectedDifficulty) {
      handleConfirm()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }, [handleConfirm, onCancel, selectedDifficulty])

  return (
    <div 
      className="popup-overlay" 
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-popup-title"
    >
      <div className="completion-popup scrollable-popup">
        <div className="popup-scroll-area">
          <h3 id="completion-popup-title">Complete Task</h3>
          
          <div className="task-text">{task.text}</div>

          <div className="form-group">
            <label id="difficulty-label">Difficulty</label>
            <div 
              className="difficulty-selector"
              role="radiogroup"
              aria-labelledby="difficulty-label"
            >
              {activeDifficulties.map(difficulty => (
                <button
                  key={difficulty.id}
                  className={`difficulty-chip ${selectedDifficulty === difficulty.id ? 'selected' : ''}`}
                  style={{ 
                    backgroundColor: selectedDifficulty === difficulty.id ? difficulty.color : 'transparent',
                    color: selectedDifficulty === difficulty.id ? '#fff' : difficulty.color,
                    borderColor: difficulty.color
                  }}
                  onClick={() => setSelectedDifficulty(difficulty.id)}
                  role="radio"
                  aria-checked={selectedDifficulty === difficulty.id}
                >
                  {difficulty.label} ({difficulty.score})
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="completion-date">Date Completed</label>
            <input
              type="date"
              id="completion-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="date-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="completion-note">Note (optional)</label>
            <textarea
              id="completion-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a short note..."
              rows={2}
              className="note-input"
              maxLength={500}
            />
          </div>
        </div>

        <div className="popup-actions popup-actions-sticky">
          <button 
            className="btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button 
            className="btn-confirm"
            onClick={handleConfirm}
            disabled={!selectedDifficulty}
            aria-disabled={!selectedDifficulty}
          >
            Complete
          </button>
        </div>
      </div>
    </div>
  )
}

export default CompletionPopup
