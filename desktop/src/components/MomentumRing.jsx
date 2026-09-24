import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { subDays, isWithinInterval } from 'date-fns'

function MomentumRing({ tasks }) {
  // Compute 7-day velocity = count of completions in last 7 days / 7
  const velocity = useMemo(() => {
    const now = new Date()
    const sevenDaysAgo = subDays(now, 7)
    
    const completionsInLast7Days = tasks.filter(t => {
      if (!t.completion || !t.completion.completedDate) return false
      const completedDate = new Date(t.completion.completedDate)
      return isWithinInterval(completedDate, { start: sevenDaysAgo, end: now })
    }).length
    
    return completionsInLast7Days / 7
  }, [tasks])
  
  // Determine color based on velocity
  const momentumColor = useMemo(() => {
    if (velocity > 1.5) return 'var(--momentum-streak)'
    if (velocity >= 0.3) return 'var(--momentum-neutral)'
    return 'var(--momentum-stalled)'
  }, [velocity])
  
  // Ring params
  const r = 20
  const circumference = 2 * Math.PI * r
  // Cap at 2/day = full ring
  const fillRatio = Math.min(velocity / 2, 1)
  const strokeDashoffset = circumference * (1 - fillRatio)
  
  return (
    <svg 
      width="48" 
      height="48" 
      viewBox="0 0 48 48"
      style={{ display: 'block' }}
    >
      {/* Background ring */}
      <circle
        cx="24"
        cy="24"
        r={r}
        stroke="var(--border-color)"
        strokeWidth="4"
        fill="none"
      />
      {/* Foreground animated ring */}
      <motion.circle
        cx="24"
        cy="24"
        r={r}
        stroke={momentumColor}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  )
}

export default MomentumRing
