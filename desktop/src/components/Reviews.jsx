import { useState, useMemo, useRef } from 'react'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, getYear, startOfYear, endOfYear } from 'date-fns'
import { calculateDayScore, parseDate, formatDate, groupTasksByDate } from '@habit-tracker/core'
import ChronoStream from './ChronoStream'
import StackedChart from './StackedChart'
import HeatmapGrid from './HeatmapSkyline'
import Dashboard from './Dashboard'
import { toPng } from 'html-to-image'

// Task Detail Popup Component
function TaskDetailPopup({ task, difficulty, category, onClose, onEditDate, onSave }) {
  const completion = task.completion
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(completion.note || '')
  const [editingTime, setEditingTime] = useState(false)
  const [timeValue, setTimeValue] = useState(completion.completedAt ? completion.completedAt.slice(11, 16) : '12:00')

  if (!completion) return null

  const completedDate = new Date(completion.completedDate)
  const completedTime = new Date(completion.completedAt)

  const handleSaveNote = () => {
    onSave({
      ...task,
      completion: { ...completion, note: noteValue }
    })
    setEditingNote(false)
  }

  const handleSaveTime = () => {
    const [hours, minutes] = timeValue.split(':').map(Number)
    const oldDate = new Date(completion.completedAt)
    oldDate.setHours(hours, minutes, 0, 0)
    onSave({
      ...task,
      completion: { ...completion, completedAt: oldDate.toISOString() }
    })
    setEditingTime(false)
  }

  return (
    <div 
      className="popup-overlay" 
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
    >
      <div className="completion-popup scrollable-popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-scroll-area">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 id="task-detail-title">Task Details</h3>
            <button 
              className="action-btn" 
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          
          <div className="task-text" style={{ marginBottom: '16px' }}>{task.text}</div>
          
          <div className="form-group">
            <label>Completion Date</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
                {format(completedDate, 'EEEE, MMMM d, yyyy')}
              </div>
              {onEditDate && (
                <button 
                  className="action-btn"
                  onClick={() => onEditDate(task)}
                  title="Edit completion date"
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                >
                  Edit Date
                </button>
              )}
            </div>
          </div>
          
          <div className="form-group">
            <label>Completion Time</label>
            {editingTime ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="time"
                  value={timeValue}
                  onChange={(e) => setTimeValue(e.target.value)}
                  className="date-input"
                  style={{ flex: 1 }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTime()
                    if (e.key === 'Escape') { setEditingTime(false); setTimeValue(completion.completedAt ? completion.completedAt.slice(11, 16) : '12:00') }
                  }}
                />
                <button className="btn-confirm" onClick={handleSaveTime} style={{ padding: '8px 16px', fontSize: '13px' }}>Save</button>
                <button className="btn-cancel" onClick={() => { setEditingTime(false); setTimeValue(completion.completedAt ? completion.completedAt.slice(11, 16) : '12:00') }} style={{ padding: '8px 16px', fontSize: '13px' }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
                  {format(completedTime, 'h:mm a')}
                </div>
                <button
                  className="action-btn"
                  onClick={() => { setTimeValue(completion.completedAt ? completion.completedAt.slice(11, 16) : '12:00'); setEditingTime(true) }}
                  title="Edit completion time"
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                >
                  Edit Time
                </button>
              </div>
            )}
          </div>
          
          {difficulty && (
            <div className="form-group">
              <label>Difficulty</label>
              <div 
                className="difficulty-badge"
                style={{ 
                  backgroundColor: difficulty.color, 
                  display: 'inline-block',
                  padding: '8px 16px',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 500
                }}
              >
                {difficulty.label} ({difficulty.score})
              </div>
            </div>
          )}
          
          <div className="form-group">
            <label>Category</label>
            {category ? (
              <div 
                className="category-badge"
                style={{ 
                  backgroundColor: category.color, 
                  display: 'inline-block',
                  padding: '8px 16px',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 500
                }}
              >
                {category.name}
              </div>
            ) : (
              <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
                No category
              </div>
            )}
          </div>
          
          <div className="form-group">
            <label>Note</label>
            {editingNote ? (
              <div>
                <textarea
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  className="note-input"
                  rows={3}
                  autoFocus
                  maxLength={500}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setEditingNote(false); setNoteValue(completion.note || '') }
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
                  <button className="btn-confirm" onClick={handleSaveNote} style={{ padding: '8px 16px', fontSize: '13px' }}>Save</button>
                  <button className="btn-cancel" onClick={() => { setEditingNote(false); setNoteValue(completion.note || '') }} style={{ padding: '8px 16px', fontSize: '13px' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ flex: 1, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', color: completion.note ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'pre-wrap', minHeight: '40px' }}>
                  {completion.note || 'No note'}
                </div>
                <button
                  className="action-btn"
                  onClick={() => { setNoteValue(completion.note || ''); setEditingNote(true) }}
                  title="Edit note"
                  style={{ padding: '8px 12px', fontSize: '13px', flexShrink: 0 }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="popup-actions popup-actions-sticky">
          <button className="btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Day Detail Popup Component
function DayDetailPopup({ date, tasks, difficulties, categories, onClose }) {
  const completedDate = new Date(date)
  const dateStr = formatDate(date)
  const dayTasks = tasks.filter(t => t.completion?.completedDate === dateStr)
  
  return (
    <div 
      className="popup-overlay" 
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-detail-title"
    >
      <div className="completion-popup" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 id="day-detail-title">
            {format(completedDate, 'EEEE, MMMM d, yyyy')}
          </h3>
          <button 
            className="action-btn" 
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
        
        <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          {dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''} completed
        </div>
        
        <div style={{ 
          maxHeight: '400px', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {dayTasks.length === 0 ? (
            <p className="empty-state">No tasks completed on this date</p>
          ) : (
            dayTasks.map(task => {
              const difficulty = difficulties.find(d => d.id === task.completion.difficultyId)
              const category = categories.find(c => c.id === task.completion.categoryId)
              const completedTime = task.completion.completedAt 
                ? format(new Date(task.completion.completedAt), 'h:mm a')
                : null
              
              return (
                <div 
                  key={task.id}
                  style={{
                    padding: '16px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <div style={{ marginBottom: '8px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {task.text}
                  </div>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                    {difficulty && (
                      <span 
                        className="difficulty-badge"
                        style={{ 
                          backgroundColor: difficulty.color,
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                      >
                        {difficulty.label} ({difficulty.score})
                      </span>
                    )}
                    {category && (
                      <span 
                        className="category-badge"
                        style={{ 
                          backgroundColor: category.color,
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                      >
                        {category.name}
                      </span>
                    )}
                    {completedTime && (
                      <span style={{ 
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)'
                      }}>
                        {completedTime}
                      </span>
                    )}
                  </div>
                  
                  {task.completion.note && (
                    <div style={{ 
                      padding: '8px 12px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {task.completion.note}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
        
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Delete Confirmation Popup Component
function DeleteConfirmPopup({ task, onConfirm, onCancel }) {
  return (
    <div 
      className="popup-overlay" 
      onClick={onCancel}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
    >
      <div className="completion-popup" onClick={(e) => e.stopPropagation()}>
        <h3 id="delete-confirm-title">Delete task?</h3>
        
        <div className="task-text" style={{ marginBottom: '16px' }}>{task.text}</div>
        
        <p style={{ color: '#ef4444', marginBottom: '24px', fontWeight: 500 }}>
          This cannot be undone.
        </p>
        
        <div className="popup-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button 
            className="btn-confirm" 
            onClick={onConfirm}
            style={{ backgroundColor: '#ef4444' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function Reviews({ data, onDayClick, onSave }) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [reviewType, setReviewType] = useState('daily')
  const [heatmapYear, setHeatmapYear] = useState(getYear(new Date()))
  const [selectedDay, setSelectedDay] = useState(null)
  const [isExporting, setIsExporting] = useState(false)
  const chartRef = useRef(null)
  const [taskToEdit, setTaskToEdit] = useState(null)

  const tasks = data?.tasks || []
  const difficulties = data?.difficulties || []
  const categories = data?.categories || []
  const settings = data?.settings || {}

  const completedTasks = useMemo(() => tasks.filter(t => t.completion), [tasks])
  
  // Pre-group completed tasks by date for O(1) lookup - MAJOR PERFORMANCE IMPROVEMENT
  const tasksByDate = useMemo(() => {
    return groupTasksByDate(completedTasks)
  }, [completedTasks])
  
  // Create difficulty and category maps for O(1) lookup
  const difficultyMap = useMemo(() => {
    return new Map(difficulties.map(d => [d.id, d]))
  }, [difficulties])

  const categoryMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c]))
  }, [categories])

  // Handler for day click from heatmap or flow chart
  const handleDayClick = (date, dayTasks) => {
    setSelectedDay({ date, tasks: dayTasks })
  }

  // Daily Review Data - OPTIMIZED: Use pre-grouped tasks
  const dailyData = useMemo(() => {
    const dateStr = formatDate(selectedDate)
    const daysTasks = tasksByDate.get(dateStr) || []
    const score = calculateDayScore(
      daysTasks, 
      difficulties, 
      settings.fatigueIncrement || 0.10, 
      settings.fatigueCap || 3.0,
      categories
    )

    return {
      date: dateStr,
      score,
      count: daysTasks.length,
      tasks: daysTasks
    }
  }, [selectedDate, tasksByDate, difficulties, categories, settings])

  // Weekly Review Data - OPTIMIZED: Use pre-grouped tasks
  const weeklyData = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: settings.weekStartsOn || 1 })
    const end = endOfWeek(selectedDate, { weekStartsOn: settings.weekStartsOn || 1 })
    const days = eachDayOfInterval({ start, end })

    const chartData = days.map(day => {
      const dateStr = formatDate(day)
      const daysTasks = tasksByDate.get(dateStr) || []
      const score = calculateDayScore(
        daysTasks,
        difficulties,
        settings.fatigueIncrement || 0.10,
        settings.fatigueCap || 3.0,
        categories
      )

      return {
        date: dateStr,
        dayName: format(day, 'EEE'),
        score,
        count: daysTasks.length
      }
    })

    const totalScore = chartData.reduce((sum, d) => sum + d.score, 0)
    const totalCount = chartData.reduce((sum, d) => sum + d.count, 0)
    const bestDay = chartData.reduce((best, d) => d.score > best.score ? d : best, chartData[0])

    return {
      chartData,
      totalScore,
      totalCount,
      bestDay
    }
  }, [selectedDate, tasksByDate, difficulties, categories, settings])

  // Heatmap Data - OPTIMIZED: Use pre-grouped tasks (O(n) instead of O(n*m))
  const heatmapData = useMemo(() => {
    const start = startOfYear(new Date(heatmapYear, 0, 1))
    const end = endOfYear(new Date(heatmapYear, 0, 1))
    const days = eachDayOfInterval({ start, end })

    return days.map(day => {
      const dateStr = formatDate(day)
      const daysTasks = tasksByDate.get(dateStr) || []
      
      let value
      if (settings.heatmapMode === 'count') {
        value = daysTasks.length
      } else {
        value = calculateDayScore(
          daysTasks,
          difficulties,
          settings.fatigueIncrement || 0.10,
          settings.fatigueCap || 3.0,
          categories
        )
      }

      return {
        date: dateStr,
        day,
        value,
        tasks: daysTasks  // Include tasks for dominant color calculation
      }
    })
  }, [heatmapYear, tasksByDate, difficulties, settings])

  const getColorIntensity = (value, maxValue) => {
    if (value === 0) return 'var(--bg-tertiary)'
    const ratio = Math.min(value / maxValue, 1)
    if (ratio > 0.75) return '#22c55e'
    if (ratio > 0.5) return '#4ade80'
    if (ratio > 0.25) return '#86efac'
    return '#bbf7d0'
  }

  const maxHeatmapValue = Math.max(...heatmapData.map(d => d.value), 1)
  
  // State for task detail popup
  const [selectedTask, setSelectedTask] = useState(null)
  
  // State for streamgraph range toggle
  const [streamRange, setStreamRange] = useState('week')

  // Export week as image handler
  const handleExportWeek = async () => {
    setIsExporting(true)
    
    // Wait for the export layout to render
    setTimeout(async () => {
      try {
        if (chartRef.current) {
          const dataUrl = await toPng(chartRef.current, {
            backgroundColor: '#1a1a2e',
            quality: 1.0
          })
          
          // Trigger download
          const link = document.createElement('a')
          link.download = `weekly-flow-state-${format(new Date(), 'yyyy-MM-dd')}.png`
          link.href = dataUrl
          link.click()
        }
      } catch (error) {
        console.error('Failed to export chart:', error)
      } finally {
        setIsExporting(false)
      }
    }, 100)
  }

  return (
    <div className="reviews-container">
      <div className="reviews-header">
        <h2>Reviews</h2>
        <div className="review-tabs">
          <button 
            className={`tab ${reviewType === 'dashboard' ? 'active' : ''}`}
            onClick={() => setReviewType('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab ${reviewType === 'daily' ? 'active' : ''}`}
            onClick={() => setReviewType('daily')}
          >
            Daily
          </button>
          <button 
            className={`tab ${reviewType === 'weekly' ? 'active' : ''}`}
            onClick={() => setReviewType('weekly')}
          >
            Flow State
          </button>
          <button 
            className={`tab ${reviewType === 'stacked' ? 'active' : ''}`}
            onClick={() => setReviewType('stacked')}
          >
            Stacked Chart
          </button>
          <button 
            className={`tab ${reviewType === 'heatmap' ? 'active' : ''}`}
            onClick={() => setReviewType('heatmap')}
          >
            Heatmap
          </button>
        </div>
      </div>

      <div className="review-content scrollable">
        {reviewType === 'dashboard' && (
          <Dashboard data={data} />
        )}

        {reviewType === 'daily' && (
          <div className="daily-review">
            <div className="date-selector">
              <input
                type="date"
                value={formatDate(selectedDate)}
                onChange={(e) => setSelectedDate(parseDate(e.target.value))}
              />
            </div>

            <div className="daily-summary">
              <div className="summary-card">
                <div className="summary-value">{dailyData.score.toFixed(1)}</div>
                <div className="summary-label">Productivity Score</div>
              </div>
              <div className="summary-card">
                <div className="summary-value">{dailyData.count}</div>
                <div className="summary-label">Tasks Completed</div>
              </div>
            </div>

            <div className="completed-tasks-list">
              {dailyData.tasks.length === 0 ? (
                <p className="empty-state">No tasks completed on this date</p>
              ) : (
                dailyData.tasks.map(task => {
                  const difficulty = difficultyMap.get(task.completion.difficultyId)
                  const category = task.completion.categoryId ? categoryMap.get(task.completion.categoryId) : null
                  
                  return (
                    <div 
                      key={task.id} 
                      className="completed-task-item"
                      style={{ cursor: 'pointer', transition: 'all var(--transition-fast)' }}
                      onClick={() => setSelectedTask(task)}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    >
                      <div className="task-info">
                        <div className="task-text">{task.text}</div>
                        <div className="task-meta">
                          {difficulty && (
                            <span 
                              className="difficulty-badge"
                              style={{ backgroundColor: difficulty.color }}
                            >
                              {difficulty.label}
                            </span>
                          )}
                          {category && (
                            <span 
                              className="category-badge"
                              style={{ backgroundColor: category.color }}
                            >
                              {category.name}
                            </span>
                          )}
                        </div>
                      </div>
                      {task.completion.note && (
                        <div className="task-note">{task.completion.note}</div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {reviewType === 'weekly' && (
          <div className="weekly-review">
            <div className="date-selector">
              <input
                type="date"
                value={formatDate(selectedDate)}
                onChange={(e) => setSelectedDate(parseDate(e.target.value))}
              />
            </div>

            <div className="weekly-summary">
              <div className="summary-card">
                <div className="summary-value">{weeklyData.totalScore.toFixed(1)}</div>
                <div className="summary-label">Total Score</div>
              </div>
              <div className="summary-card">
                <div className="summary-value">{weeklyData.totalCount}</div>
                <div className="summary-label">Tasks Completed</div>
              </div>
              <div className="summary-card">
                <div className="summary-value">{weeklyData.bestDay?.score.toFixed(1) || 0}</div>
                <div className="summary-label">Best Day ({weeklyData.bestDay?.dayName || '-'})</div>
              </div>
            </div>

            {/* Streamgraph Range Toggle */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['week', 'month', 'all'].map(r => (
                  <button
                    key={r}
                    className={`tab ${streamRange === r ? 'active' : ''}`}
                    onClick={() => setStreamRange(r)}
                    style={{
                      padding: '6px 12px',
                      background: streamRange === r ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      color: streamRange === r ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '13px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)'
                    }}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExportWeek}
                disabled={isExporting}
                style={{
                  background: isExporting ? 'var(--bg-tertiary)' : 'var(--accent-color, #8b5cf6)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  opacity: isExporting ? 0.7 : 1,
                  transition: 'all var(--transition-fast)'
                }}
              >
                {isExporting ? 'Exporting...' : 'Export Week'}
              </button>
            </div>

            {/* Chrono-Stream River Chart */}
            <ChronoStream
              tasks={completedTasks}
              categories={categories}
              difficulties={difficulties}
              range={streamRange}
              flowStateColor={settings.flowStateColor}
              weekStartsOn={settings.weekStartsOn}
              onDayClick={handleDayClick}
              isExporting={isExporting}
              chartRef={chartRef}
            />
          </div>
        )}

        {reviewType === 'stacked' && (
          <div className="stacked-review">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['week', 'month', 'all'].map(r => (
                  <button
                    key={r}
                    className={`tab ${streamRange === r ? 'active' : ''}`}
                    onClick={() => setStreamRange(r)}
                    style={{
                      padding: '6px 12px',
                      background: streamRange === r ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      color: streamRange === r ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '13px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)'
                    }}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Stacked Bar Chart showing category distribution per day */}
            <StackedChart
              tasks={completedTasks}
              categories={categories}
              difficulties={difficulties}
              range={streamRange}
              weekStartsOn={settings.weekStartsOn}
              onDayClick={handleDayClick}
            />
          </div>
        )}

        {reviewType === 'heatmap' && (
          <div className="heatmap-review">
            <div className="heatmap-header">
              <button onClick={() => setHeatmapYear(heatmapYear - 1)}>←</button>
              <span>{heatmapYear}</span>
              <button onClick={() => setHeatmapYear(heatmapYear + 1)}>→</button>
            </div>

            {/* GitHub-style Flat Heatmap */}
            <HeatmapGrid heatmapData={heatmapData} categories={categories} onDayClick={handleDayClick} />
          </div>
        )}
      </div>

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          difficulty={difficulties.find(d => d.id === selectedTask.completion.difficultyId)}
          category={categories.find(c => c.id === selectedTask.completion.categoryId)}
          onClose={() => setSelectedTask(null)}
          onEditDate={(task) => {
            setSelectedTask(null)
            setTaskToEdit(task)
          }}
          onSave={(updatedTask) => {
            const updatedTasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
            onSave({ ...data, tasks: updatedTasks, meta: { ...data.meta, updatedAt: new Date().toISOString() } })
            setSelectedTask(updatedTask)
          }}
        />
      )}

      {/* Edit Date Popup */}
      {taskToEdit && (
        <div 
          className="popup-overlay" 
          onClick={() => setTaskToEdit(null)}
          onKeyDown={(e) => e.key === 'Escape' && setTaskToEdit(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-date-title"
        >
          <div className="completion-popup" onClick={(e) => e.stopPropagation()}>
            <h3 id="edit-date-title">Edit Completion Date</h3>
            
            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              Update the completion date for this task. This is useful when you work past midnight or need to correct a mistake.
            </p>
            
            <div className="form-group">
              <label>New Completion Date</label>
              <input
                type="date"
                value={taskToEdit.completion.completedDate}
                onChange={(e) => {
                  const newDate = e.target.value
                  // Update the task with new date, keeping the same time component
                  const updatedTasks = tasks.map(t => {
                    if (t.id === taskToEdit.id) {
                      return {
                        ...t,
                        completion: {
                          ...t.completion,
                          completedDate: newDate
                        }
                      }
                    }
                    return t
                  })
                  
                  onSave({
                    ...data,
                    tasks: updatedTasks,
                    meta: { ...data.meta, updatedAt: new Date().toISOString() }
                  })
                  setTaskToEdit(null)
                }}
              />
            </div>
            
            <div className="popup-actions">
              <button className="btn-cancel" onClick={() => setTaskToEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Day Detail Popup */}
      {selectedDay && (
        <DayDetailPopup
          date={selectedDay.date}
          tasks={tasks}
          difficulties={difficulties}
          categories={categories}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}

export default Reviews
