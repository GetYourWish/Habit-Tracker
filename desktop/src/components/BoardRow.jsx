import { memo, useState, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const BoardRow = memo(function BoardRow({ 
  id, 
  task, 
  marker, 
  category, 
  isEditing, 
  onEdit, 
  onUpdate, 
  onCancelEdit, 
  onDelete, 
  onComplete, 
  onConfirmDelete, 
  onMoveUp, 
  onMoveDown,
  isSelected,
  onSelect,
  isWorkingOn,
  onToggleWorkingOn,
  selectionSize = 1,
  onAddTaskBelow,
  onUpdateMarkerNote,
  isConsecutiveMarker = false
}) {
  const [editText, setEditText] = useState(task?.text || '')
  const [showCategoryNotePopup, setShowCategoryNotePopup] = useState(false)
  const [categoryNoteEdit, setCategoryNoteEdit] = useState('')
  const [isEditingNote, setIsEditingNote] = useState(false)
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id,
    data: { 
      type: task ? 'task' : 'marker',
      boardItem: true
    }
  })
  
  // Diagnostic: completely bypass inline style to isolate React #62 source
  // If error persists, the style prop is NOT the cause — it's elsewhere in the tree
  const style = undefined
  void transform // prevent unused var warning
  void transition

  // Determine if we should enable drag on the row body (for multi-select)
  // Only when this item is selected AND there are multiple items selected
  const enableRowDrag = isSelected && selectionSize > 1
  
  // Merge listeners for row-body drag when in multi-select mode
  const rowListeners = enableRowDrag ? listeners : {}

  // Sync local editText when task changes - crucial fix for empty text tasks
  useEffect(() => {
    if (task?.text !== undefined) {
      setEditText(task.text)
    }
  }, [task?.text])

  // Sync category note from marker when it changes
  useEffect(() => {
    if (marker && marker.note !== undefined) {
      setCategoryNoteEdit(marker.note || '')
    }
  }, [marker?.note, marker?.id])

  if (marker) {
    return (
      <div 
        ref={setNodeRef}
        className={`board-row marker-row row-enter-scale ${isSelected ? 'selected' : ''} ${isConsecutiveMarker ? 'consecutive-marker' : ''}`}
        role="listitem"
        aria-label={`Category marker: ${String(category?.name ?? '')}`}
        data-board-item-id={id}
        onClick={(e) => {
          // Marker rows should NEVER be selected by clicking on them
          // They can only be selected programmatically or via keyboard navigation if needed
          // This prevents accidental selection when clicking near the marker
          e.stopPropagation()
        }}
        {...rowListeners}
      >
        <div 
          className="drag-handle"
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label="Drag handle"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              listeners.onKeyDown(e)
            }
          }}
        >
          ⋮⋮
        </div>
        <div 
          className="category-marker"
          style={{ backgroundColor: category.color + '4D', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          {/* Category note indicator - always visible */}
          <div 
            className="category-note-indicator"
            onClick={(e) => {
              e.stopPropagation()
              setCategoryNoteEdit(marker.note || '')
              setShowCategoryNotePopup(true)
            }}
            title="Click to add/edit category note"
          >
            i
          </div>
          <span>/{String(category.name)}</span>
          <button 
            className="add-task-marker-btn"
            onClick={(e) => {
              e.stopPropagation() // Prevent row selection
              onAddTaskBelow && onAddTaskBelow()
            }}
            title={`Add task below ${String(category.name)}`}
            aria-label={`Add task below ${String(category.name)}`}
          >
            +
          </button>
        </div>
        
        {/* Category note edit popup - rendered at root level to avoid stretching */}
        {showCategoryNotePopup && (
          <div className="category-note-popup-wrapper">
            <div className="category-note-edit-popup-overlay" onClick={(e) => {
              e.stopPropagation()
              setShowCategoryNotePopup(false)
              setCategoryNoteEdit('')
              setIsEditingNote(false)
            }} />
            <div className="category-note-edit-popup" onClick={(e) => e.stopPropagation()}>
              {!isEditingNote ? (
                // View mode - similar to completion popup structure
                <div className="category-note-view-content">
                  <h3 id="category-note-popup-title">Category Note</h3>
                  <div className="category-name-display">{String(category.name)}</div>
                  <div className="category-note-text">
                    {marker.note && String(marker.note).trim() !== '' ? (
                      String(marker.note)
                    ) : (
                      <span className="no-note-message">No note added</span>
                    )}
                  </div>
                  <div className="note-view-actions">
                    <button 
                      className="btn-cancel"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCategoryNotePopup(false)
                        setCategoryNoteEdit('')
                        setIsEditingNote(false)
                      }}
                    >
                      Close
                    </button>
                    <button 
                      className="btn-confirm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCategoryNoteEdit(marker.note || '')
                        setIsEditingNote(true)
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ) : (
                // Edit mode
                <div className="category-note-edit-content">
                  <h3 id="category-note-popup-title">Edit Category Note</h3>
                  <div className="category-name-display">{String(category.name)}</div>
                  <textarea
                    value={categoryNoteEdit}
                    onChange={(e) => setCategoryNoteEdit(e.target.value)}
                    placeholder="Enter category note..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        // Save note to marker
                        onUpdateMarkerNote && onUpdateMarkerNote(marker.id, categoryNoteEdit)
                        setShowCategoryNotePopup(false)
                        setCategoryNoteEdit('')
                        setIsEditingNote(false)
                      } else if (e.key === 'Escape') {
                        setShowCategoryNotePopup(false)
                        setCategoryNoteEdit('')
                        setIsEditingNote(false)
                      }
                    }}
                  />
                  <div className="note-edit-actions">
                    <button 
                      className="save-note-btn btn-cancel"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Save note to marker
                        onUpdateMarkerNote && onUpdateMarkerNote(marker.id, categoryNoteEdit)
                        setShowCategoryNotePopup(false)
                        setCategoryNoteEdit('')
                        setIsEditingNote(false)
                      }}
                    >
                      Save
                    </button>
                    <button 
                      className="cancel-note-btn btn-cancel"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCategoryNotePopup(false)
                        setCategoryNoteEdit('')
                        setIsEditingNote(false)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="move-buttons">
          <button 
            className="move-btn"
            onClick={onMoveUp}
            aria-label="Move up"
            title="Move up"
          >
            ↑
          </button>
          <button 
            className="move-btn"
            onClick={onMoveDown}
            aria-label="Move down"
            title="Move down"
          >
            ↓
          </button>
        </div>
        <button 
          className="delete-marker-btn"
          onClick={onDelete}
          aria-label={`Delete ${String(category.name)} marker`}
        >
          ✕
        </button>
      </div>
    )
  }

  const handleEditChange = (e) => {
    setEditText(e.target.value)
  }

  const handleEditBlur = () => {
    if (editText.trim() !== task.text) {
      onUpdate(editText.trim() || task.text)
    }
    onCancelEdit()
  }

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (editText.trim() !== task.text) {
        onUpdate(editText.trim() || task.text)
      }
      onCancelEdit()
    } else if (e.key === 'Escape') {
      setEditText(task.text)
      onCancelEdit()
    }
  }

  return (
    <div 
      ref={setNodeRef}
      className={`board-row task-row row-enter-slide ${isEditing ? 'editing' : ''} ${isSelected ? 'selected' : ''} ${isWorkingOn ? 'working-on' : ''}`}
      role="listitem"
      aria-label={`Task: ${String(task?.text ?? '')}`}
      data-board-item-id={id}
      onClick={(e) => {
        // Check if clicking on the task text with modifier key - should toggle selection, not edit
        if (e.target.closest('.task-text-display')) {
          const multiSelectModifier = window.__multiSelectModifier || 'ctrl'
          let isMultiSelect = false
          if (multiSelectModifier === 'ctrl') {
            isMultiSelect = e.ctrlKey || e.metaKey
          } else if (multiSelectModifier === 'shift') {
            isMultiSelect = e.shiftKey
          } else if (multiSelectModifier === 'alt') {
            isMultiSelect = e.altKey
          }
          
          if (isMultiSelect && onSelect) {
            e.stopPropagation()
            onSelect(id, { 
              ctrl: e.ctrlKey, 
              meta: e.metaKey, 
              shift: e.shiftKey, 
              alt: e.altKey 
            })
            return
          }
          // No modifier - proceed with edit
          onEdit()
          return
        }
        
        // Clicking elsewhere on the row (not handle, buttons, or task text)
        if (onSelect && !e.target.closest('.drag-handle') && !e.target.closest('button') && !e.target.closest('.task-input')) {
          const multiSelectModifier = window.__multiSelectModifier || 'ctrl'
          let isMultiSelect = false
          if (multiSelectModifier === 'ctrl') {
            isMultiSelect = e.ctrlKey || e.metaKey
          } else if (multiSelectModifier === 'shift') {
            isMultiSelect = e.shiftKey
          } else if (multiSelectModifier === 'alt') {
            isMultiSelect = e.altKey
          }
          
          if (isMultiSelect) {
            e.stopPropagation()
            onSelect(id, { 
              ctrl: e.ctrlKey, 
              meta: e.metaKey, 
              shift: e.shiftKey, 
              alt: e.altKey 
            })
          }
          // Plain click without modifier does NOT select - prevents accidental selection
        }
      }}
      {...rowListeners}
    >
      <div 
        className="drag-handle"
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label="Drag handle"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            listeners.onKeyDown(e)
          }
        }}
      >
        ⋮⋮
      </div>

      {category && (
        <div 
          className="category-indicator"
          style={{ backgroundColor: category.color }}
          title={category.name}
          aria-hidden="true"
        />
      )}

      {isEditing ? (
        <input
          type="text"
          className="task-input editing"
          value={editText}
          onChange={handleEditChange}
          onBlur={handleEditBlur}
          onKeyDown={handleEditKeyDown}
          autoFocus
          aria-label="Edit task"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div 
          className="task-text-display"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onEdit()
            }
          }}
        >
          {String(task?.text ?? '')}
        </div>
      )}

      <div className="task-actions">
        <button 
          className={`action-btn working-on-toggle ${isWorkingOn ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleWorkingOn(id)
          }}
          aria-label={isWorkingOn ? 'Remove working on highlight' : 'Mark as working on'}
          title={isWorkingOn ? 'Stop working on' : 'Mark as working on'}
        >
          {isWorkingOn ? '★' : '☆'}
        </button>
        <button 
          className="action-btn complete-btn"
          onClick={onComplete}
          aria-label={`Complete task: ${String(task?.text ?? '')}`}
          title="Complete"
        >
          ✓
        </button>
        <div className="move-buttons">
          <button 
            className="move-btn"
            onClick={onMoveUp}
            aria-label="Move up"
            title="Move up"
          >
            ↑
          </button>
          <button 
            className="move-btn"
            onClick={onMoveDown}
            aria-label="Move down"
            title="Move down"
          >
            ↓
          </button>
        </div>
        <button 
          className="action-btn delete-btn"
          onClick={() => onConfirmDelete(task)}
          aria-label={`Delete task: ${String(task?.text ?? '')}`}
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  )
})

export default BoardRow
