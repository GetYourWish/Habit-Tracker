import { useMemo, useState } from 'react'
import { format } from 'date-fns'

export default function HeatmapGrid({ heatmapData, categories, onDayClick }) {
  const [hoveredCell, setHoveredCell] = useState(null)
  
  // GitHub-style color scale
  const getCellColor = (value) => {
    if (value === 0) return '#161b22'  // Empty cell (dark gray)
    if (value < 0.5) return '#0e4429'  // Lowest
    if (value < 1.5) return '#006d32'  // Low
    if (value < 2.5) return '#26a641'  // Medium
    return '#39d353'                   // High
  }
  
  // Calculate year and offset from first data point
  const year = heatmapData.length > 0 ? heatmapData[0].day.getFullYear() : new Date().getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const offset = startOfYear.getDay() // 0-6, weekday of Jan 1
  
  // Helper to calculate week index for a given date
  const getWeekIndex = (date) => {
    const diffTime = date - startOfYear
    const dayOfYear = Math.round(diffTime / 86400000) // milliseconds in a day
    return Math.floor((dayOfYear + offset) / 7)
  }
  
  // Calculate numWeeks from last cell
  const numWeeks = useMemo(() => {
    if (heatmapData.length === 0) return 53
    const lastCell = heatmapData[heatmapData.length - 1]
    return getWeekIndex(lastCell.day) + 1
  }, [heatmapData])
  
  // Month names
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  
  const handleCellHover = (cell, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoveredCell({
      cell,
      x: rect.left + rect.width / 2,
      y: rect.top
    })
  }
  
  const handleCellLeave = () => {
    setHoveredCell(null)
  }
  
  return (
    <div className="heatmap-grid-container" style={{ position: 'relative' }}>
      {/* Outer wrapper card */}
      <div
        style={{
          width: '100%',
          maxWidth: '1000px',
          margin: '0 auto',
          padding: '16px',
          boxSizing: 'border-box',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)'
        }}
      >
        {/* Month label row - aligned with grid columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${numWeeks}, 1fr)`,
            columnGap: '3px',
            marginBottom: '4px',
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}
        >
          {monthNames.map((month, m) => {
            const monthDate = new Date(year, m, 1)
            const weekIndex = getWeekIndex(monthDate)
            return (
              <span
                key={month}
                style={{ gridColumnStart: weekIndex + 1 }}
              >
                {month}
              </span>
            )
          })}
        </div>
        
        {/* Day grid */}
        <div
          className="heatmap-flat-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${numWeeks}, 1fr)`,
            gridTemplateRows: 'repeat(7, auto)',
            gap: '3px'
          }}
        >
          {heatmapData.map((cell, index) => {
            const bgColor = getCellColor(cell.value)
            const dayOfYear = Math.round((cell.day - startOfYear) / 86400000)
            const weekIndex = Math.floor((dayOfYear + offset) / 7)
            const rowIndex = cell.day.getDay()
            
            return (
              <div
                key={index}
                className="heatmap-cell"
                style={{
                  gridColumnStart: weekIndex + 1,
                  gridRowStart: rowIndex + 1,
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: '2px',
                  backgroundColor: bgColor,
                  cursor: cell.value > 0 ? 'pointer' : 'default',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  handleCellHover(cell, e);
                }}
                onMouseLeave={() => {
                  handleCellLeave();
                }}
                onClick={() => onDayClick && onDayClick(cell.day, cell.tasks)}
              />
            )
          })}
        </div>
        
        {/* Legend */}
        <div
          className="heatmap-legend"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '4px',
            marginTop: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}
        >
          <span>Less</span>
          {[0, 0.5, 1.5, 2.5].map((threshold, i) => (
            <div
              key={i}
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                backgroundColor: getCellColor(threshold)
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      
      {/* Tooltip */}
      {hoveredCell && hoveredCell.cell.value > 0 && (
        <div
          className="chart-tooltip-glass"
          style={{
            position: 'fixed',
            left: hoveredCell.x,
            top: hoveredCell.y - 10,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          <div style={{ 
            fontWeight: 600, 
            marginBottom: '4px',
            color: 'var(--text-primary)',
            fontSize: '12px'
          }}>
            {format(hoveredCell.cell.day, 'EEE, MMM d, yyyy')}
          </div>
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-secondary)'
          }}>
            {hoveredCell.cell.count || hoveredCell.cell.value} task{hoveredCell.cell.tasks?.length !== 1 ? 's' : ''} completed
          </div>
        </div>
      )}
      
      {/* Empty tooltip for zero-value cells */}
      {hoveredCell && hoveredCell.cell.value === 0 && (
        <div
          className="chart-tooltip-glass"
          style={{
            position: 'fixed',
            left: hoveredCell.x,
            top: hoveredCell.y - 10,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          <div style={{ 
            fontWeight: 600, 
            marginBottom: '4px',
            color: 'var(--text-primary)',
            fontSize: '12px'
          }}>
            {format(hoveredCell.cell.day, 'EEE, MMM d, yyyy')}
          </div>
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-muted)'
          }}>
            No tasks completed
          </div>
        </div>
      )}
    </div>
  )
}
