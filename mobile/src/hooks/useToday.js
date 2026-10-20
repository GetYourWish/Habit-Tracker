// useToday — keeps "today" true on Android.
//
// The screens used to compute the local date once per render, so an app left
// open overnight kept rendering yesterday: wrong date label, habits grouped
// against the old day, check-ins aimed at a date that had already rolled
// over. This hook re-checks the LOCAL calendar date on a slow interval and
// re-renders the screen exactly once when it changes.
//
// Android suspends timers while backgrounded, so the interval alone could
// stay stale after a resume — the hook also re-checks on every transition to
// 'active' (same pattern as useTracker's foreground refresh).

import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { getCurrentDate } from '@habit-tracker/core'

export function useToday(intervalMs = 30000) {
  const [today, setToday] = useState(getCurrentDate())

  useEffect(() => {
    const check = () => {
      const now = getCurrentDate()
      setToday(prev => (prev === now ? prev : now))
    }

    const timer = setInterval(check, intervalMs)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check()
    })

    return () => {
      clearInterval(timer)
      // Optional chaining keeps cleanup safe with older/test implementations
      // that expose no handle (same guard as useTracker).
      subscription?.remove?.()
    }
  }, [intervalMs])

  return today
}
