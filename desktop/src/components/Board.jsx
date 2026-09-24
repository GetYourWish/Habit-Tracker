import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  DndContext,
  closestCorners,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import CompletionPopup from './CompletionPopup'
import BoardRow from './BoardRow'
import { generateId, getCurrentDate, getTaskCategory, calculateTaskScoreBreakdown } from '@habit-tracker/core'

// Simple category chip with + button to add marker
function CategoryChip({ category, onAddMarker, onNavigateToMarker }) {
  return (
    <div 
      className="category-chip" 
      style={{ backgroundColor: category.color }}
      onClick={onNavigateToMarker}
      title="Click to navigate to this category on the board"
    >
      <span className="category-chip-name">{category.name}</span>
      <button
        className="chip-add-marker-btn"
        title="Add marker to board"
        aria-label={`Add ${category.name} marker to the board`}
        onClick={(e) => {
          e.stopPropagation() // Prevent triggering the chip click
          onAddMarker()
        }}
      >
        +
      </button>
    </div>
  )
}

// Drop indicator overlay component - appears as a glowing blue line without affecting layout
function DropIndicator({ activeId }) {
  const [position, setPosition] = useState({ top: 0, width: 0 })
  
  useEffect(() => {
    // Calculate position based on the active insertion point ID
    const isInsertTop = activeId === 'insert-top'
    
    // Find the element to position relative to
    let targetElement
    if (isInsertTop) {
      targetElement = document.querySelector('.board-list')
    } else {
      targetElement = document.querySelector(`[data-board-item-id="${activeId}"]`)
    }
    
    if (!targetElement) return
    
    const containerRect = document.querySelector('.board-list')?.getBoundingClientRect()
    if (!containerRect) return
    
    let topPosition
    if (isInsertTop) {
      topPosition = 0
    } else {
      const rect = targetElement.getBoundingClientRect()
      topPosition = rect.bottom - containerRect.top + 2
    }
    
    setPosition({
      top: topPosition,
      width: containerRect.width
    })
  }, [activeId])
  
  return (
    <div 
      className="drop-indicator-overlay"
      style={{
        top: `${position.top}px`,
        width: `${position.width}px`
      }}
    >
      <div className="drop-indicator-line" />
    </div>
  )
}

// Insertion point component for precise drop locations
function InsertionPoint({ id, forceActive, onDrop, className = '' }) {
  const { setNodeRef, isOver } = useDroppable({ 
    id,
    data: {
      type: 'insertion-point',
      insertionId: id
    }
  })
  
  // Show as active when droppable is over OR when forceActive is true (for drop indicator)
  const isActive = isOver || forceActive
  
  return (
    <div
      ref={setNodeRef}
      className={`insertion-point ${isActive ? 'is-over' : ''} ${className}`}
      data-insertion-id={id}
      style={{
        // Ensure insertion points are always rendered and have height
        minHeight: '8px',
        display: 'block',
        // Make sure pointer events work for drop detection
        pointerEvents: 'auto'
      }}
    />
  )
}

// Sidebar component for categories - simple list with + button on chips
function CategorySidebar({ categories, onCreateCategory, onAddMarker, onNavigateToCategory }) {
  const [isCreating, setIsCreating] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#60a5fa')
  const [isCollapsed, setIsCollapsed] = useState(false)
  
  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return

    const newCategory = {
      id: generateId(),
      name: newCategoryName.trim(),
      color: newCategoryColor,
      order: 0,
      active: true
    }

    // Insert at top and re-index all orders
    const updatedCategories = [newCategory, ...categories].map((cat, idx) => ({
      ...cat,
      order: idx
    }))

    onCreateCategory(updatedCategories)

    setNewCategoryName('')
    setIsCreating(false)
  }
  
  if (isCollapsed) {
    return (
      <div className="category-grabber collapsed">
        <button 
          className="categories-toggle"
          onClick={() => setIsCollapsed(false)}
        >
          Show Categories ({categories.length})
        </button>
      </div>
    );
  }
  
  return (
    <div className="category-grabber">
      <div className="category-grabber-header">
        <h4>Categories</h4>
        <button 
          className="collapse-btn"
          onClick={() => setIsCollapsed(true)}
          aria-label="Collapse categories"
        >
          −
        </button>
      </div>
      <p className="drag-hint">Click + on a category to add a marker to the board</p>
      
      <div className="categories-list">
        {[...categories].sort((a, b) => {
          const pa = a.priorityMultiplier ?? 1
          const pb = b.priorityMultiplier ?? 1
          if (pb !== pa) return pb - pa
          return (a.name || '').localeCompare(b.name || '')
        }).filter(c => c.active !== false).map((category) => (
          <CategoryChip
            key={category.id}
            category={category}
            onAddMarker={() => onAddMarker(category)}
            onNavigateToMarker={() => onNavigateToCategory(category)}
          />
        ))}

        {isCreating ? (
          <div className="new-category-form">
            <input
              type="text"
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              autoFocus
            />
            <input
              type="color"
              value={newCategoryColor}
              onChange={(e) => setNewCategoryColor(e.target.value)}
            />
            <button onClick={handleCreateCategory}>Add</button>
            <button onClick={() => setIsCreating(false)}>Cancel</button>
          </div>
        ) : (
          <button 
            className="add-category-btn"
            onClick={() => setIsCreating(true)}
          >
            + Add Category
          </button>
        )}
      </div>
    </div>
  )
}

function Board({ data, onSave }) {
  // Derive state directly from props - no duplication
  const tasks = useMemo(() => data?.tasks?.filter(t => !t.completion) || [], [data?.tasks])
  const boardItems = useMemo(() => data?.board || [], [data?.board])
  const markers = useMemo(() => data?.markers || [], [data?.markers])
  const categories = useMemo(() => data?.categories || [], [data?.categories])
  const difficulties = useMemo(() => data?.difficulties || [], [data?.difficulties])
  const settings = useMemo(() => data?.settings || {}, [data?.settings])
  
  const [editingTask, setEditingTask] = useState(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [completionTask, setCompletionTask] = useState(null)
  const [showCategoryGrabber, setShowCategoryGrabber] = useState(false)
  const [draggingItem, setDraggingItem] = useState(null)
  const [deleteTask, setDeleteTask] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [activeInsertionPoint, setActiveInsertionPoint] = useState(null)
  const [workingOnId, setWorkingOnId] = useState(null)
  const [dropIndicatorId, setDropIndicatorId] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [quickCatForm, setQuickCatForm] = useState(null)
  const [popoverPos, setPopoverPos] = useState(null)
  const dropIndicatorRef = useRef(null)
  const pointerYRef = useRef(0)
  const dragMoveListenerRef = useRef(null)
  const dragMoveRafRef = useRef(null)
  const quickCatRef = useRef(null)
  const addCatBtnRef = useRef(null)

  // Close quick cat popover on outside click
  useEffect(() => {
    if (!quickCatForm) {
      setPopoverPos(null)
      return
    }
    const handler = (e) => {
      if (quickCatRef.current && !quickCatRef.current.contains(e.target) &&
          addCatBtnRef.current && !addCatBtnRef.current.contains(e.target)) {
        setQuickCatForm(null)
        setPopoverPos(null)
      }
    }
    const timer = setTimeout(() => document.addEventListener('pointerdown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', handler)
    }
  }, [quickCatForm])

  const openQuickCatForm = useCallback(() => {
    if (addCatBtnRef.current) {
      const rect = addCatBtnRef.current.getBoundingClientRect()
      setPopoverPos({ top: rect.bottom + 6, left: rect.right - 220 })
    }
    setQuickCatForm({ name: '', color: '#60a5fa' })
  }, [])

  const setDropIndicator = (id) => {
    dropIndicatorRef.current = id
    setDropIndicatorId(id)
  }

  const cleanupDragListeners = () => {
    if (dragMoveListenerRef.current) {
      window.removeEventListener('pointermove', dragMoveListenerRef.current)
      dragMoveListenerRef.current = null
    }
  }
  
  // Derived memoized array for working on tasks (persisted in data.workingOn)
  const workingOnTasks = useMemo(() => data?.workingOn || [], [data?.workingOn])
  
  // Apply theme from settings and persist resolved value
  useEffect(() => {
    const theme = settings.theme || 'system'
    const root = document.documentElement
    let resolvedTheme = theme
    
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light')
    } else {
      // System theme
      root.removeAttribute('data-theme')
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.setAttribute('data-theme', 'dark')
        resolvedTheme = 'dark'
      } else {
        resolvedTheme = 'light'
      }
    }
    
    // Persist resolved theme to localStorage for instant bootstrap on reload
    localStorage.setItem('pt-theme', resolvedTheme)
    
    // Store multi-select modifier for BoardRow to access
    window.__multiSelectModifier = settings.multiSelectModifier || 'ctrl'
    
    // Apply consecutive marker margin CSS variable from settings
    const consecutiveMarkerMargin = settings.consecutiveMarkerMargin || '150px'
    root.style.setProperty('--consecutive-marker-margin', consecutiveMarkerMargin)
  }, [settings.theme, settings.multiSelectModifier, settings.consecutiveMarkerMargin])

  // dnd-kit sensors — hooks must be called unconditionally at the top level.
  // (Previously wrapped in useMemo(() => useSensors(...), []) which violated
  // the Rules of Hooks: on updates the memo factory was skipped, so the inner
  // useSensor hooks never ran and shifted every subsequent hook, crashing
  // areHookInputsEqual with "Cannot read properties of undefined (reading 'length')".)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const handleCreateTask = useCallback(() => {
    if (!newTaskText.trim()) return

    const newTask = {
      id: generateId(),
      text: newTaskText.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completion: null
    }

    const updatedTasks = [...data.tasks, newTask]
    const updatedBoard = [{ type: 'task', taskId: newTask.id }, ...boardItems]

    setNewTaskText('')

    onSave({
      ...data,
      tasks: updatedTasks,
      board: updatedBoard,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [newTaskText, data.tasks, boardItems, data, onSave])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreateTask()
    } else if (e.key === 'Escape') {
      // Cancel new task input and clear selection
      setNewTaskText('')
      handleClearSelection()
    }
  }

  // Handle Escape key for clearing selection at document level
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClearSelection()
      }
    }
    
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  const handleUpdateTask = useCallback((taskId, newText) => {
    const updatedTasks = data.tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, text: newText, updatedAt: new Date().toISOString() }
      }
      return t
    })

    onSave({
      ...data,
      tasks: updatedTasks,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [data, onSave])

  const handleDeleteTask = useCallback((taskId) => {
    const updatedTasks = data.tasks.filter(t => t.id !== taskId)
    const updatedBoard = boardItems.filter(item => 
      !(item.type === 'task' && item.taskId === taskId)
    )
    // Remove from workingOn if present
    const updatedWorkingOn = (data.workingOn || []).filter(id => id !== taskId)

    onSave({
      ...data,
      tasks: updatedTasks,
      board: updatedBoard,
      workingOn: updatedWorkingOn,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [data.tasks, boardItems, data.workingOn, data, onSave])

  const handleMoveItem = useCallback((itemId, direction) => {
    const itemIndex = boardItems.findIndex(item => {
      if (item.type === 'task') return item.taskId === itemId
      if (item.type === 'marker') return item.markerId === itemId
      return false
    })
    
    if (itemIndex === -1) return
    
    const newIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1
    if (newIndex < 0 || newIndex >= boardItems.length) return
    
    const newBoard = [...boardItems]
    const temp = newBoard[itemIndex]
    newBoard[itemIndex] = newBoard[newIndex]
    newBoard[newIndex] = temp
    
    onSave({
      ...data,
      board: newBoard,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [boardItems, data, onSave])

  const handleCompleteClick = useCallback((task) => {
    setCompletionTask(task)
  }, [])

  const handleCompletionConfirm = useCallback((completionData) => {
    // Since state is derived from props, we directly compute updated data
    // Find task index in boardItems to determine category based on markers ONLY
    const taskIndex = boardItems.findIndex(item => item.type === 'task' && item.taskId === completionData.taskId)
    
    // Strict marker-based category derivation: scan boardItems for MARKER entries only
    // Find nearest marker above and nearest marker below; task gets that category ONLY if
    // both exist and both reference the same category ID
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
      // Same marker above and below (shouldn't happen normally, but just in case)
      const marker = markers.find(m => m.id === aboveMarker.markerId)
      if (marker) categoryId = marker.categoryId
    } else if (aboveMarker && belowMarker) {
      // Check if both markers reference the same category
      const aboveMarkerObj = markers.find(m => m.id === aboveMarker.markerId)
      const belowMarkerObj = markers.find(m => m.id === belowMarker.markerId)
      if (aboveMarkerObj && belowMarkerObj && aboveMarkerObj.categoryId === belowMarkerObj.categoryId) {
        categoryId = aboveMarkerObj.categoryId
      }
    }
    
    const completedAt = new Date().toISOString()
    
    // Build the completed task object to compute score breakdown
    const completedTask = {
      id: completionData.taskId,
      text: data.tasks.find(t => t.id === completionData.taskId)?.text || '',
      completion: {
        completedDate: completionData.date,
        completedAt,
        difficultyId: completionData.difficultyId,
        categoryId,
        note: completionData.note || ''
      }
    }

    // Compute score breakdown using all completed tasks (including this one)
    const allCompleted = [...data.tasks.filter(t => t.completion), completedTask]
    const breakdown = calculateTaskScoreBreakdown(
      completedTask,
      allCompleted,
      difficulties,
      settings.fatigueIncrement || 0.10,
      settings.fatigueCap || 3.0,
      categories
    )

    // Create log entry
    const logEntry = {
      id: generateId(),
      timestamp: completedAt,
      taskId: completionData.taskId,
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

    const updatedTasks = data.tasks.map(t => {
      if (t.id === completionData.taskId) {
        return {
          ...t,
          completion: {
            completedDate: completionData.date,
            completedAt,
            difficultyId: completionData.difficultyId,
            categoryId: categoryId,
            note: completionData.note || ''
          }
        }
      }
      return t
    })

    const updatedBoard = boardItems.filter(item => 
      !(item.type === 'task' && item.taskId === completionData.taskId)
    )
    
    // Remove from workingOn if present
    const updatedWorkingOn = (data.workingOn || []).filter(id => id !== completionData.taskId)

    // Cap logs at 500 entries
    const existingLogs = data.logs || []
    const updatedLogs = existingLogs.length >= 500
      ? [...existingLogs.slice(existingLogs.length - 499), logEntry]
      : [...existingLogs, logEntry]

    onSave({
      ...data,
      tasks: updatedTasks,
      board: updatedBoard,
      workingOn: updatedWorkingOn,
      logs: updatedLogs,
      meta: { ...data.meta, updatedAt: completedAt }
    })

    setCompletionTask(null)
  }, [boardItems, markers, categories, data.workingOn, data, onSave, difficulties, settings])

  const handleToggleWorkingOn = useCallback((itemId) => {
    const currentWorkingOn = data.workingOn || []
    let newWorkingOn
    if (currentWorkingOn.includes(itemId)) {
      newWorkingOn = currentWorkingOn.filter(id => id !== itemId)
    } else {
      newWorkingOn = [...currentWorkingOn, itemId]
    }
    
    onSave({
      ...data,
      workingOn: newWorkingOn,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [data, onSave])

  const handleSelectItem = useCallback((itemId, modifierKey) => {
    // Determine which modifier is configured in settings
    const multiSelectModifier = settings.multiSelectModifier || 'ctrl'
    
    // Check if the correct modifier key is pressed based on settings
    let isMultiSelect = false
    if (multiSelectModifier === 'ctrl') {
      isMultiSelect = modifierKey.ctrl || modifierKey.meta
    } else if (multiSelectModifier === 'shift') {
      isMultiSelect = modifierKey.shift
    } else if (multiSelectModifier === 'alt') {
      isMultiSelect = modifierKey.alt
    }
    
    setSelectedItems(prev => {
      if (isMultiSelect) {
        // Toggle selection with modifier click
        if (prev.includes(itemId)) {
          return prev.filter(id => id !== itemId)
        } else {
          return [...prev, itemId]
        }
      } else {
        // Single click - select only this item
        return [itemId]
      }
    })
  }, [settings.multiSelectModifier])

  const handleClearSelection = useCallback(() => {
    setSelectedItems([])
  }, [])

  const handleDragStart = useCallback((event) => {
    setDraggingItem(event.active)
    pointerYRef.current = event.activatorEvent?.clientY ?? 0
    const onMove = (e) => { pointerYRef.current = e.clientY }
    dragMoveListenerRef.current = onMove
    window.addEventListener('pointermove', onMove)
  }, [])

  const handleDragMove = useCallback((event) => {
    const { active, over } = event
    if (!over) { 
      setDropIndicator(null)
      return 
    }

    // Throttle to once per animation frame to avoid excessive re-renders
    if (dragMoveRafRef.current) return
    dragMoveRafRef.current = requestAnimationFrame(() => {
      dragMoveRafRef.current = null

      if (over.data.current?.type === 'insertion-point') {
        setDropIndicator(over.id)
        return
      }

      // over is a row: highlight the gap ABOVE or BELOW it based on pointer Y
      const idx = boardItems.findIndex(item => (item.type === 'task' ? item.taskId : item.markerId) === over.id)
      if (idx === -1) { 
        setDropIndicator(null)
        return 
      }

      const el = document.querySelector(`[data-board-item-id="${over.id}"]`)
      const rect = el?.getBoundingClientRect()
      const before = rect ? pointerYRef.current < rect.top + rect.height / 2 : false

      if (before) {
        if (idx === 0) {
          setDropIndicator('insert-top')
        } else {
          const prev = boardItems[idx - 1]
          const prevId = prev.type === 'task' ? prev.taskId : prev.markerId
          setDropIndicator(prevId)
        }
      } else {
        setDropIndicator(over.id)
      }
    })
  }, [boardItems])

  const handleAddMarker = useCallback((category) => {
    const newMarker = {
      id: generateId(),
      categoryId: category.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    onSave({
      ...data,
      markers: [...markers, newMarker],
      board: [...boardItems, { type: 'marker', markerId: newMarker.id }],
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [data, markers, boardItems, onSave])

  const handleCreateCategory = useCallback((updatedCategories) => {
    onSave({ ...data, categories: updatedCategories, meta: { ...data.meta, updatedAt: new Date().toISOString() } })
  }, [data, onSave])

  const handleNavigateToCategory = useCallback((category) => {
    // Find the first marker of this category on the board
    const firstMarkerItem = boardItems.find(item => {
      if (item.type !== 'marker') return false
      const marker = markers.find(m => m.id === item.markerId)
      return marker && marker.categoryId === category.id
    })
    
    if (firstMarkerItem) {
      const marker = markers.find(m => m.id === firstMarkerItem.markerId)
      if (marker) {
        // Scroll to the marker element on the board
        setTimeout(() => {
          const markerElement = document.querySelector(`[data-board-item-id="${firstMarkerItem.markerId}"]`)
          if (markerElement) {
            markerElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            markerElement.classList.add('random-flash')
            setTimeout(() => markerElement.classList.remove('random-flash'), 1000)
          }
        }, 100)
      }
    }
  }, [boardItems, markers])

  const handleQuickCreateCategory = useCallback((name, color) => {
    const newCategory = {
      id: generateId(),
      name: name.trim(),
      color,
      order: categories.length,
      active: true,
      priorityMultiplier: 1
    }
    const updatedCategories = [...categories, newCategory]
    onSave({
      ...data,
      categories: updatedCategories,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
    setQuickCatForm(null)
    setPopoverPos(null)
  }, [categories, data, onSave])

  const handleRandomizeTask = useCallback(() => {
    const availableTaskIds = boardItems
      .filter(item => item.type === 'task')
      .map(item => item.taskId)
      .filter(id => tasks.some(t => t.id === id))

    if (availableTaskIds.length === 0) return

    const currentWorkingOn = data.workingOn || []
    const candidates = availableTaskIds.filter(id => !currentWorkingOn.includes(id))
    const pool = candidates.length > 0 ? candidates : availableTaskIds
    const randomId = pool[Math.floor(Math.random() * pool.length)]

    if (!currentWorkingOn.includes(randomId)) {
      onSave({
        ...data,
        workingOn: [...currentWorkingOn, randomId],
        meta: { ...data.meta, updatedAt: new Date().toISOString() }
      })
    }

    setTimeout(() => {
      const rowElement = document.querySelector(`[data-board-item-id="${randomId}"]`)
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        rowElement.classList.add('random-flash')
        setTimeout(() => rowElement.classList.remove('random-flash'), 1000)
      }
    }, 100)
  }, [boardItems, tasks, data, onSave])

  const handleAddTaskBelowMarker = useCallback((markerId) => {
    const newTask = {
      id: generateId(),
      text: '', // Empty string so it enters edit mode
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completion: null
    }

    const insertIndex = boardItems.findIndex(item => item.type === 'marker' && item.markerId === markerId)
    if (insertIndex === -1) return

    const updatedBoard = [
      ...boardItems.slice(0, insertIndex + 1),
      { type: 'task', taskId: newTask.id },
      ...boardItems.slice(insertIndex + 1)
    ]

    onSave({
      ...data,
      tasks: [...data.tasks, newTask],
      board: updatedBoard,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })

    // Enter edit mode immediately so the user can start typing
    setEditingTask(newTask.id)
  }, [boardItems, data, onSave])

  const handleDragEnd = (event) => {
    const { active } = event
    const indicatorId = dropIndicatorRef.current
    if (dragMoveRafRef.current) {
      cancelAnimationFrame(dragMoveRafRef.current)
      dragMoveRafRef.current = null
    }
    setDraggingItem(null)
    setDropIndicator(null)
    cleanupDragListeners()

    if (!indicatorId) return

    const draggedIndex = boardItems.findIndex(item => (item.type === 'task' ? item.taskId : item.markerId) === active.id)
    if (draggedIndex === -1) return

    const isDraggingSelected = selectedItems.includes(active.id)

    if (isDraggingSelected && selectedItems.length > 1) {
      const selectedBoardItems = []
      const remainingBoardItems = []
      boardItems.forEach(item => {
        const itemId = item.type === 'task' ? item.taskId : item.markerId
        if (selectedItems.includes(itemId)) selectedBoardItems.push(item)
        else remainingBoardItems.push(item)
      })
      let insertIndex
      if (indicatorId === 'insert-top') insertIndex = 0
      else {
        const anchor = remainingBoardItems.findIndex(item => (item.type === 'task' ? item.taskId : item.markerId) === indicatorId)
        insertIndex = anchor === -1 ? remainingBoardItems.length : anchor + 1
      }
      remainingBoardItems.splice(insertIndex, 0, ...selectedBoardItems)
      onSave({ ...data, board: remainingBoardItems, meta: { ...data.meta, updatedAt: new Date().toISOString() } })
    } else {
      let targetIndex
      if (indicatorId === 'insert-top') targetIndex = 0
      else {
        const idx = boardItems.findIndex(item => (item.type === 'task' ? item.taskId : item.markerId) === indicatorId)
        if (idx === -1) return
        targetIndex = idx + 1
      }
      const newBoard = [...boardItems]
      const [removed] = newBoard.splice(draggedIndex, 1)
      const adjusted = targetIndex > draggedIndex ? targetIndex - 1 : targetIndex
      newBoard.splice(adjusted, 0, removed)
      onSave({ ...data, board: newBoard, meta: { ...data.meta, updatedAt: new Date().toISOString() } })
    }

    setSelectedItems([])
  }

  const handleDragCancel = useCallback(() => {
    if (dragMoveRafRef.current) {
      cancelAnimationFrame(dragMoveRafRef.current)
      dragMoveRafRef.current = null
    }
    setDraggingItem(null)
    setDropIndicator(null)
    cleanupDragListeners()
  }, [cleanupDragListeners])

  const handleMarkerDrop = useCallback((categoryId, isNewCategory = false, insertionId = null, categoryObj = null, appendToEnd = false) => {
    // If this is a new category being created, we need to add it to categories first
    if (isNewCategory && typeof categoryId === 'object') {
      // categoryId is actually the new category object
      const newCategory = categoryId
      const updatedCategories = [...categories, newCategory]
      
      const newMarker = {
        id: generateId(),
        categoryId: newCategory.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      const updatedMarkers = [...markers, newMarker]
      let updatedBoard
      
      // Insert at specific position if insertionId is provided
      if (insertionId !== null) {
        const insertIndex = boardItems.findIndex(item => {
          if (item.type === 'task') return item.taskId === insertionId
          if (item.type === 'marker') return item.markerId === insertionId
          return false
        })
        if (insertIndex >= 0) {
          updatedBoard = [
            ...boardItems.slice(0, insertIndex + 1),
            { type: 'marker', markerId: newMarker.id },
            ...boardItems.slice(insertIndex + 1)
          ]
        } else {
          updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
        }
      } else if (appendToEnd) {
        updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
      } else {
        updatedBoard = [{ type: 'marker', markerId: newMarker.id }, ...boardItems]
      }

      onSave({
        ...data,
        categories: updatedCategories,
        markers: updatedMarkers,
        board: updatedBoard,
        meta: { ...data.meta, updatedAt: new Date().toISOString() }
      })
      return
    }
    
    // Normal case - existing category from sidebar
    if (categoryObj) {
      // We have the category object passed directly
      const newMarker = {
        id: generateId(),
        categoryId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      const updatedMarkers = [...markers, newMarker]
      let updatedBoard
      
      // Insert at specific position if insertionId is provided
      if (insertionId !== null) {
        const insertIndex = boardItems.findIndex(item => {
          if (item.type === 'task') return item.taskId === insertionId
          if (item.type === 'marker') return item.markerId === insertionId
          return false
        })
        if (insertIndex >= 0) {
          updatedBoard = [
            ...boardItems.slice(0, insertIndex + 1),
            { type: 'marker', markerId: newMarker.id },
            ...boardItems.slice(insertIndex + 1)
          ]
        } else if (appendToEnd) {
          updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
        } else {
          updatedBoard = [{ type: 'marker', markerId: newMarker.id }, ...boardItems]
        }
      } else if (appendToEnd) {
        updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
      } else {
        updatedBoard = [{ type: 'marker', markerId: newMarker.id }, ...boardItems]
      }

      onSave({
        ...data,
        markers: updatedMarkers,
        board: updatedBoard,
        meta: { ...data.meta, updatedAt: new Date().toISOString() }
      })
      return
    }
    
    // Fallback case - existing category without object
    const newMarker = {
      id: generateId(),
      categoryId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const updatedMarkers = [...markers, newMarker]
    let updatedBoard
    
    // Insert at specific position if insertionId is provided
    if (insertionId !== null) {
      const insertIndex = boardItems.findIndex(item => {
        if (item.type === 'task') return item.taskId === insertionId
        if (item.type === 'marker') return item.markerId === insertionId
        return false
      })
      if (insertIndex >= 0) {
        updatedBoard = [
          ...boardItems.slice(0, insertIndex + 1),
          { type: 'marker', markerId: newMarker.id },
          ...boardItems.slice(insertIndex + 1)
        ]
      } else if (appendToEnd) {
        updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
      } else {
        updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
      }
    } else if (appendToEnd) {
      updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
    } else {
      updatedBoard = [...boardItems, { type: 'marker', markerId: newMarker.id }]
    }

    onSave({
      ...data,
      markers: updatedMarkers,
      board: updatedBoard,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [data, markers, boardItems, categories, onSave])

  const handleDeleteMarker = useCallback((markerId) => {
    const updatedMarkers = markers.filter(m => m.id !== markerId)
    const updatedBoard = boardItems.filter(item => 
      !(item.type === 'marker' && item.markerId === markerId)
    )

    onSave({
      ...data,
      markers: updatedMarkers,
      board: updatedBoard,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [markers, boardItems, data, onSave])

  const handleUpdateMarkerNote = useCallback((markerId, note) => {
    const updatedMarkers = markers.map(m => {
      if (m.id === markerId) {
        return { 
          ...m, 
          note: note.trim(),
          updatedAt: new Date().toISOString() 
        }
      }
      return m
    })

    onSave({
      ...data,
      markers: updatedMarkers,
      meta: { ...data.meta, updatedAt: new Date().toISOString() }
    })
  }, [markers, data, onSave])


  // Filter boardItems to only include items that will actually be rendered
  // This ensures index-based lookups work correctly for consecutive marker detection
  const visibleBoardItems = useMemo(() => {
    return boardItems.filter(item => {
      if (item.type === 'task') {
        const task = tasks.find(t => t.id === item.taskId)
        return task && !task.completion
      } else if (item.type === 'marker') {
        const marker = markers.find(m => m.id === item.markerId)
        return marker
      }
      return false
    })
  }, [boardItems, tasks, markers])

  // Pre-compute task→category lookup map for O(1) per task instead of O(n) getTaskCategory scans
  const categoryLookup = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < boardItems.length; i++) {
      const item = boardItems[i]
      if (item.type !== 'task') continue
      const cat = getTaskCategory(i, boardItems, markers, categories)
      if (cat) map.set(item.taskId, cat)
    }
    return map
  }, [boardItems, markers, categories])

  // Pre-compute task map for O(1) lookups
  const taskMap = useMemo(() => {
    const map = new Map()
    for (const t of tasks) map.set(t.id, t)
    return map
  }, [tasks])

  // Pre-compute marker map for O(1) lookups
  const markerMap = useMemo(() => {
    const map = new Map()
    for (const m of markers) map.set(m.id, m)
    return map
  }, [markers])

  // Pre-compute category map for O(1) lookups
  const categoryMap = useMemo(() => {
    const map = new Map()
    for (const c of categories) map.set(c.id, c)
    return map
  }, [categories])

  // Memoize sortable item IDs
  const sortableItemIds = useMemo(() =>
    boardItems.map(i => i.type === 'task' ? i.taskId : i.markerId)
  , [boardItems])

  // Render board rows with insertion points
  const renderBoardRows = useMemo(() => {
    const rows = []
    
    // Add insertion point at the top
    rows.push(
      <InsertionPoint 
        key="insert-top" 
        id="insert-top" 
        onDrop={(categoryId, isNew, _) => handleMarkerDrop(categoryId, isNew, null)} 
        forceActive={dropIndicatorId === 'insert-top'}
      />
    )
    
    visibleBoardItems.forEach((item, index) => {
      const prevItem = visibleBoardItems[index - 1]
      
      if (item.type === 'task') {
        const task = taskMap.get(item.taskId)
        const category = categoryLookup.get(item.taskId) || null

        rows.push(
          <BoardRow
            key={item.taskId}
            id={item.taskId}
            task={task}
            category={category}
            isEditing={editingTask === task.id}
            onEdit={() => setEditingTask(task.id)}
            onUpdate={(text) => {
              handleUpdateTask(task.id, text)
              setEditingTask(null)
            }}
            onCancelEdit={() => setEditingTask(null)}
            onDelete={() => handleDeleteTask(task.id)}
            onComplete={() => handleCompleteClick(task)}
            onConfirmDelete={(t) => setDeleteTask(t)}
            onMoveUp={() => handleMoveItem(item.taskId, 'up')}
            onMoveDown={() => handleMoveItem(item.taskId, 'down')}
            isSelected={selectedItems.includes(item.taskId)}
            onSelect={handleSelectItem}
            isWorkingOn={workingOnTasks.includes(item.taskId)}
            onToggleWorkingOn={handleToggleWorkingOn}
            selectionSize={selectedItems.length}
          />
        )
        
        // Add insertion point after this task
        rows.push(
          <InsertionPoint 
            key={`insert-${item.taskId}`} 
            id={item.taskId} 
            onDrop={(categoryId, isNew, _) => handleMarkerDrop(categoryId, isNew, item.taskId)} 
            forceActive={dropIndicatorId === item.taskId}
          />
        )
      } else if (item.type === 'marker') {
        const marker = markerMap.get(item.markerId)
        if (!marker) return

        const category = categoryMap.get(marker.categoryId)
        if (!category) return

        // Check if previous visible item is also a marker (for consecutive spacing)
        const isConsecutiveMarker = prevItem?.type === 'marker'

        rows.push(
          <BoardRow
            key={item.markerId}
            id={item.markerId}
            marker={marker}
            category={category}
            onDelete={() => handleDeleteMarker(item.markerId)}
            onMoveUp={() => handleMoveItem(item.markerId, 'up')}
            onMoveDown={() => handleMoveItem(item.markerId, 'down')}
            isSelected={selectedItems.includes(item.markerId)}
            onSelect={handleSelectItem}
            selectionSize={selectedItems.length}
            onAddTaskBelow={() => handleAddTaskBelowMarker(item.markerId)}
            onUpdateMarkerNote={handleUpdateMarkerNote}
            isConsecutiveMarker={isConsecutiveMarker}
          />
        )
        
        // Add insertion point after this marker (always normal height for precise DnD)
        rows.push(
          <InsertionPoint 
            key={`insert-${item.markerId}`} 
            id={item.markerId} 
            onDrop={(categoryId, isNew, _) => handleMarkerDrop(categoryId, isNew, item.markerId)} 
            forceActive={dropIndicatorId === item.markerId}
          />
        )
      }
    })
    
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBoardItems, editingTask, selectedItems, workingOnTasks, dropIndicatorId, categoryLookup, taskMap, markerMap, handleSelectItem, handleCompleteClick, handleDeleteTask, handleUpdateTask, handleDeleteMarker, handleMoveItem, handleAddTaskBelowMarker, handleMarkerDrop, handleUpdateMarkerNote, handleToggleWorkingOn, settings])

  return (
    <div className="board-container">
      <div 
        className="board-content-wrapper"
        onClick={(e) => {
          // Clear selection when clicking on empty board area
          if (e.target === e.currentTarget) {
            handleClearSelection()
          }
        }}
      >
        <div className="board-main">
          <div className="board-header">
            <h2>Board</h2>
            <input
              type="text"
              className="new-task-input header-input"
              placeholder="Type a task and press Enter..."
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={sortableItemIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="board-list" style={{ position: 'relative' }}>
                {/* Drop indicator overlay */}
                {dropIndicatorId && (
                  <DropIndicator 
                    activeId={dropIndicatorId} 
                    boardItems={boardItems}
                  />
                )}
                {renderBoardRows}
                
                {tasks.length === 0 && boardItems.length === 0 && (
                  <div className="board-empty-state">
                    <h3>No tasks yet</h3>
                    <p>Type above to add your first task and start tracking your performance!</p>
                  </div>
                )}
              </div>
            </SortableContext>

            <DragOverlay>
              {draggingItem ? (
                <div className="drag-overlay">
                  {selectedItems.length > 1 
                    ? `Dragging ${selectedItems.length} items`
                    : draggingItem.data.current?.type === 'task' 
                      ? String(taskMap.get(draggingItem.id)?.text ?? '')
                      : 'Category Marker'
                  }
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
        
        <div className={`board-right-panel${sidebarCollapsed ? ' collapsed' : ''}`}>
          {sidebarCollapsed ? (
            <>
              <button
                type="button"
                className="sidebar-icon-btn"
                onClick={handleRandomizeTask}
                title="Pick a random task to work on"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <button
                type="button"
                className="sidebar-icon-btn"
                ref={addCatBtnRef}
                onClick={openQuickCatForm}
                title="Add new category"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="2" />
                  <rect x="14" y="3" width="7" height="7" rx="2" />
                  <rect x="3" y="14" width="7" height="7" rx="2" />
                  <rect x="14" y="14" width="7" height="7" rx="2" />
                  <line x1="12" y1="12" x2="12" y2="12.01" stroke="none" />
                  <line x1="17.5" y1="17.5" x2="17.5" y2="17.5" stroke="none" />
                  <circle cx="17.5" cy="17.5" r="3" fill="currentColor" stroke="none" />
                  <line x1="17.5" y1="15" x2="17.5" y2="20" stroke="white" strokeWidth="2" />
                  <line x1="15" y1="17.5" x2="20" y2="17.5" stroke="white" strokeWidth="2" />
                </svg>
              </button>

              {quickCatForm && popoverPos && (
                <div
                  className="quick-cat-popover"
                  ref={quickCatRef}
                  style={{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    placeholder="Category name"
                    value={quickCatForm.name}
                    onChange={(e) => setQuickCatForm({ ...quickCatForm, name: e.target.value })}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && quickCatForm.name.trim()) {
                        handleQuickCreateCategory(quickCatForm.name, quickCatForm.color)
                      } else if (e.key === 'Escape') {
                        setQuickCatForm(null)
                        setPopoverPos(null)
                      }
                    }}
                  />
                  <input
                    type="color"
                    value={quickCatForm.color}
                    onChange={(e) => setQuickCatForm({ ...quickCatForm, color: e.target.value })}
                  />
                  <button
                    className="quick-cat-confirm"
                    onClick={() => {
                      if (quickCatForm.name.trim()) handleQuickCreateCategory(quickCatForm.name, quickCatForm.color)
                    }}
                  >
                    Add
                  </button>
                </div>
              )}

              <button
                type="button"
                className="sidebar-toggle-btn"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="randomizer-btn"
                onClick={handleRandomizeTask}
                title="Pick a random task to work on"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: '-2px' }}>
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                Randomizer
              </button>
              <div className="board-sidebar">
                <CategorySidebar
                  categories={categories}
                  onCreateCategory={handleCreateCategory}
                  onAddMarker={handleAddMarker}
                  onNavigateToCategory={handleNavigateToCategory}
                />
              </div>

              <button
                type="button"
                className="sidebar-toggle-btn"
                onClick={() => setSidebarCollapsed(true)}
                title="Minimize sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {completionTask && (
        <CompletionPopup
          task={completionTask}
          difficulties={difficulties}
          onConfirm={handleCompletionConfirm}
          onCancel={() => setCompletionTask(null)}
        />
      )}

      {deleteTask && (
        <div className="popup-overlay" onClick={() => setDeleteTask(null)}>
          <div className="completion-popup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="popup-header">
              <h3>Delete task?</h3>
              <button 
                className="close-btn"
                onClick={() => setDeleteTask(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="popup-content">
              <p className="task-text">{String(deleteTask?.text ?? '')}</p>
              <p className="warning-text">This cannot be undone.</p>
            </div>
            <div className="popup-actions">
              <button 
                className="cancel-btn"
                onClick={() => setDeleteTask(null)}
              >
                Cancel
              </button>
              <button 
                className="delete-btn confirm-delete"
                onClick={() => {
                  handleDeleteTask(deleteTask.id)
                  setDeleteTask(null)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Board
