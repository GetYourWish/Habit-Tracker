import { useEffect, useState } from 'react'
import { getCurrentDate } from '@habit-tracker/core'

// useToday — keeps "today" true.
//
// The views used to compute the local date ONCE per render, so an app left
// open overnight kept rendering yesterday: wrong date label, habits grouped
// against the old day, check-ins aimed at a date that had already rolled
// over. This hook re-checks the LOCAL calendar date on a slow interval and
// re-renders the view exactly once when it changes — a habit tracker is
// precisely the kind of app people leave open for days.
export function useToday(intervalMs = 30000) {
  const [today, setToday] = useState(getCurrentDate())

  useEffect(() => {
    const timer = setInterval(() => {
      const now = getCurrentDate()
      setToday(prev => (prev === now ? prev : now))
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return today
}
