import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { format, eachDayOfInterval, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isAfter } from 'date-fns'
import { formatDate, parseDate, groupTasksByDate } from '@habit-tracker/core'

// Extracted outside parent to avoid remount on every render
function StackedTooltip({ active, payload, label, chartData, categories }) {
  if (!active || !payload || !payload.length) return null
  const dayData = chartData.find(d => 
    d.date === label || 
    d.dayName === label || 
    d.fullDate === label
  )
  if (dayData?.isFuture) return null
  const categoryData = payload
    .filter(p => p.value > 0)
    .map(p => {
      const catId = p.dataKey.replace('cat_', '')
      const category = categories.find(c => c.id === catId)
      return { name: category?.name || 'Unknown', color: category?.color || p.color, value: p.value }
    })
  return (
    <div className="chart-tooltip-glass">
      <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)', fontSize: '13px' }}>
        {dayData?.fullDate || label}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Total: {dayData?.total || 0} tasks
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {categoryData.map((cat, idx) => (
          <div key={idx} style={{ fontSize: '11px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: cat.color }} />
            {cat.name}: {cat.value}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function StackedChart({ tasks, categories, difficulties, range, weekStartsOn = 1, onDayClick }) {
  const [hoveredBar, setHoveredBar] = useState(null)
  
  // Pre-group tasks by date for O(1) per-day lookup instead of O(n) filter per day
  const tasksByDate = useMemo(() => groupTasksByDate(tasks), [tasks])
  
  // Get today's date at midnight for comparisons
  const getTodayMidnight = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }
  
  // Determine date range based on prop
  const dateRange = useMemo(() => {
    const today = getTodayMidnight()
    
    if (range === 'week') {
      // Weekly: Monday to Sunday of current week
      const start = startOfWeek(today, { weekStartsOn: weekStartsOn || 1 })
      const end = endOfWeek(today, { weekStartsOn: weekStartsOn || 1 })
      return { start, end, type: 'week' }
    } else if (range === 'month') {
      // Monthly: First to last day of current month
      const start = startOfMonth(today)
      const end = endOfMonth(today)
      return { start, end, type: 'month' }
    } else if (range === 'all') {
      // All: From first logged task to last logged task only
      const dates = tasks.map(t => t.completion?.completedDate).filter(Boolean).sort()
      if (dates.length === 0) {
        return { start: today, end: today, type: 'all' }
      }
      const startDate = parseDate(dates[0])
      const endDate = parseDate(dates[dates.length - 1])
      return { start: startDate, end: endDate, type: 'all' }
    }
    // Default: last 7 days
    return { start: subDays(today, 6), end: today, type: 'default' }
  }, [range, tasks, weekStartsOn])
  
  // Transform data for stacked bar chart - group tasks by date and category
  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
    const today = getTodayMidnight()
    
    // Build a map of category stats for sorting
    const getCategoryStats = (dayTasks) => {
      const categoryCount = {}
      dayTasks.forEach(task => {
        const catId = task.completion?.categoryId
        if (catId) {
          categoryCount[catId] = (categoryCount[catId] || 0) + 1
        }
      })
      return categoryCount
    }
    
    // Sort categories by task count (descending), then by creation date (younger first) for ties
    const getSortedCategories = (dayTasks) => {
      const categoryCount = getCategoryStats(dayTasks)
      const categoryIds = Object.keys(categoryCount)
      
      return categoryIds.sort((a, b) => {
        const countA = categoryCount[a]
        const countB = categoryCount[b]
        
        // Primary sort: by task count (descending - most tasks first/bottom)
        if (countB !== countA) {
          return countB - countA
        }
        
        // Tiebreaker: younger creation date first (more recent = lower in stack)
        const catA = categories.find(c => c.id === a)
        const catB = categories.find(c => c.id === b)
        
        if (!catA || !catB) return 0
        
        const dateA = catA.createdAt ? new Date(catA.createdAt) : new Date(0)
        const dateB = catB.createdAt ? new Date(catB.createdAt) : new Date(0)
        
        // Younger (more recent) date should come first (be at bottom)
        return dateB - dateA
      })
    }
    
    return days.map(day => {
      const dayStr = formatDate(day)
      const daysTasks = tasksByDate.get(dayStr) || []
      
      // Check if this day is in the future
      const dayMidnight = new Date(day)
      dayMidnight.setHours(0, 0, 0, 0)
      const isFuture = isAfter(dayMidnight, today)
      
      // For 'week' and 'month' views: future days get null data
      // For 'all' view: we don't have future days since range ends at last logged task
      if ((dateRange.type === 'week' || dateRange.type === 'month') && isFuture) {
        return {
          date: dayStr,
          dayName: format(day, 'EEE'),
          fullDate: format(day, 'MMM d'),
          isFuture: true,
          total: 0
        }
      }
      
      // Group tasks by category
      const categoryCount = getCategoryStats(daysTasks)
      const sortedCategoryIds = getSortedCategories(daysTasks)
      
      // Build the data object for Recharts
      const dataPoint = {
        date: dayStr,
        dayName: format(day, 'EEE'),
        fullDate: format(day, 'MMM d'),
        isFuture: false,
        total: daysTasks.length
      }
      
      // Add category counts in sorted order
      sortedCategoryIds.forEach((catId, index) => {
        const category = categories.find(c => c.id === catId)
        const key = `cat_${catId}`
        dataPoint[key] = categoryCount[catId]
        dataPoint[`${key}_name`] = category?.name || 'Unknown'
        dataPoint[`${key}_color`] = category?.color || '#888888'
        dataPoint[`${key}_order`] = index
      })
      
      return dataPoint
    })
  }, [tasks, categories, dateRange])
  
  // Get unique categories that appear in the data for legend
  const activeCategories = useMemo(() => {
    const catSet = new Set()
    chartData.forEach(day => {
      if (!day.isFuture) {
        Object.keys(day).forEach(key => {
          if (key.startsWith('cat_') && !key.includes('_name') && !key.includes('_color') && !key.includes('_order')) {
            const catId = key.replace('cat_', '')
            const category = categories.find(c => c.id === catId)
            if (category) {
              catSet.add({ id: catId, name: category.name, color: category.color })
            }
          }
        })
      }
    })
    return Array.from(catSet)
  }, [chartData, categories])
  

  
  // Generate bars for each category
  const renderBars = () => {
    // Get all unique category keys from the data
    const categoryKeys = new Set()
    chartData.forEach(day => {
      if (!day.isFuture) {
        Object.keys(day).forEach(key => {
          if (key.startsWith('cat_') && !key.includes('_name') && !key.includes('_color') && !key.includes('_order')) {
            categoryKeys.add(key)
          }
        })
      }
    })
    
    // Convert to array and sort by order in data (based on first day that has data)
    const sortedKeys = Array.from(categoryKeys).sort((a, b) => {
      // Find first day where both categories exist and compare their order
      for (const day of chartData) {
        if (!day.isFuture && day[`${a}_order`] !== undefined && day[`${b}_order`] !== undefined) {
          return day[`${a}_order`] - day[`${b}_order`]
        }
      }
      return 0
    })
    
    return sortedKeys.map(key => {
      const catId = key.replace('cat_', '')
      const category = categories.find(c => c.id === catId)
      return (
        <Bar
          key={key}
          dataKey={key}
          stackId="categories"
          fill={category?.color || '#888888'}
          name={category?.name || 'Category'}
          onClick={(data) => {
            if (onDayClick && !data.isFuture) {
              onDayClick(
                parseDate(data.date),
                tasksByDate.get(data.date) || []
              )
            }
          }}
          style={{ cursor: 'pointer' }}
        />
      )
    })
  }
  
  // XAxis dataKey based on range
  const xAxisDataKey = range === 'month' ? 'fullDate' : 'dayName'
  
  if (chartData.length === 0) {
    return (
      <div className="stacked-chart" style={{ 
        background: 'var(--bg-secondary)', 
        borderRadius: 'var(--radius-lg)',
        padding: '40px',
        textAlign: 'center',
        color: 'var(--text-muted)'
      }}>
        No data for this range
      </div>
    )
  }
  
  return (
    <div className="stacked-chart-container" style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart 
          data={chartData}
          margin={{ top: 10, right: 40, left: 0, bottom: 10 }}
          onMouseMove={(state) => {
            const point = state?.activePayload?.[0]?.payload
            setHoveredBar(point && !point.isFuture ? point : null)
          }}
          onMouseLeave={() => setHoveredBar(null)}
          onClick={(state) => {
            const point = state?.activePayload?.[0]?.payload
            if (point && point.total > 0 && !point.isFuture && onDayClick) {
              onDayClick(
                parseDate(point.date),
                tasksByDate.get(point.date) || []
              )
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis 
            dataKey={xAxisDataKey}
            tick={{ fill: 'var(--text-secondary)', fontSize: range === 'month' ? 10 : 12 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            type="category"
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip content={<StackedTooltip chartData={chartData} categories={categories} />} />
          {renderBars()}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
