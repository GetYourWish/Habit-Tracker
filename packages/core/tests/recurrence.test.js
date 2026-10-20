import { describe, it, expect } from 'vitest'
import {
  addDays,
  diffDays,
  startOfWeek,
  isScheduledOn,
  periodKey,
  evaluateHabitStatus,
  calculateStreak,
  calculateBestStreak,
  nextDueDates,
  describeFrequency,
  indexCompletions
} from '../src/recurrence.js'

// The recurrence engine is the single source of truth for WHEN a habit is
// due and how streaks are counted — desktop and Android must agree on it
// byte for byte. These tests lock the scheduling matrix and the streak
// period-walking semantics (one visit per calendar period, no double counts).

const habit = { id: 'h1' }
const daily = { kind: 'daily', timesPerPeriod: 1, graceDays: 0 }
const weekdays = { kind: 'weekdays', weekdays: [1, 2, 3, 4, 5], timesPerPeriod: 1, graceDays: 0 }
const weekly = { kind: 'weekly', timesPerPeriod: 1, graceDays: 0 }
const twiceWeekly = { kind: 'weekly', timesPerPeriod: 2, graceDays: 0 }
const monthly = { kind: 'monthly', timesPerPeriod: 1, graceDays: 0 }
const monthlyPinned = { kind: 'monthly', monthDays: [1, 15], timesPerPeriod: 1, graceDays: 0 }
const yearly = { kind: 'yearly', timesPerPeriod: 1, graceDays: 0 }
const yearlyAnchored = { kind: 'yearly', anchorDate: '2024-06-15', timesPerPeriod: 1, graceDays: 0 }
const every2 = { kind: 'every-n', interval: 2, anchorDate: '2026-01-01', timesPerPeriod: 1, graceDays: 1 }
const every2weeks = { kind: 'every-n-weeks', interval: 2, anchorDate: '2026-01-05', timesPerPeriod: 1, graceDays: 0 }

function comps(dates) {
  // completion list for habit h1 from an array of 'YYYY-MM-DD'
  return indexCompletions(dates.map((d, i) => ({ id: 'c' + i, habitId: 'h1', date: d })))
}

describe('date helpers', () => {
  it('addDays / diffDays round-trip across month and year edges', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01') // leap year
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28)
    expect(diffDays('2026-01-01', '2025-01-01')).toBe(365)
    expect(diffDays('2025-01-01', '2024-01-01')).toBe(366) // 2024 is a leap year
    expect(addDays('2026-10-20', -diffDays('2026-10-20', '2026-10-01'))).toBe('2026-10-01')
  })

  it('startOfWeek respects weekStartsOn', () => {
    // 2026-10-20 is a Tuesday
    expect(startOfWeek('2026-10-20', 1)).toBe('2026-10-19') // Monday
    expect(startOfWeek('2026-10-20', 0)).toBe('2026-10-18') // Sunday
    expect(startOfWeek('2026-10-18', 1)).toBe('2026-10-12')
  })
})

describe('isScheduledOn', () => {
  it('daily is due every day', () => {
    expect(isScheduledOn(daily, '2026-10-20')).toBe(true)
    expect(isScheduledOn(daily, '2026-10-25')).toBe(true)
  })

  it('weekdays Mon-Fri only (0 = Sunday)', () => {
    expect(isScheduledOn(weekdays, '2026-10-19')).toBe(true)  // Mon
    expect(isScheduledOn(weekdays, '2026-10-23')).toBe(true)  // Fri
    expect(isScheduledOn(weekdays, '2026-10-24')).toBe(false) // Sat
    expect(isScheduledOn(weekdays, '2026-10-25')).toBe(false) // Sun
  })

  it('monthly is due all month unless days pinned', () => {
    expect(isScheduledOn(monthly, '2026-10-09')).toBe(true)
    expect(isScheduledOn(monthlyPinned, '2026-10-09')).toBe(false)
    expect(isScheduledOn(monthlyPinned, '2026-10-15')).toBe(true)
    expect(isScheduledOn(monthlyPinned, '2026-10-01')).toBe(true)
    // a pinned 31st simply skips in a 30-day month
    expect(isScheduledOn({ kind: 'monthly', monthDays: [31] }, '2026-09-30')).toBe(false)
  })

  it('yearly anchored to the anniversary window only', () => {
    expect(isScheduledOn(yearly, '2026-05-05')).toBe(true) // unanchored: all year
    expect(isScheduledOn(yearlyAnchored, '2026-06-15')).toBe(true)
    expect(isScheduledOn(yearlyAnchored, '2026-06-14')).toBe(false)
  })

  it('every-n phases from the anchor in both directions', () => {
    expect(isScheduledOn(every2, '2026-01-01')).toBe(true)
    expect(isScheduledOn(every2, '2026-01-02')).toBe(false)
    expect(isScheduledOn(every2, '2026-01-03')).toBe(true)
    expect(isScheduledOn(every2, '2025-12-30')).toBe(true) // negative side of the anchor
    expect(isScheduledOn(every2, '2025-12-31')).toBe(false)
  })

  it('every-n-weeks is due only in every n-th week from the anchor', () => {
    expect(isScheduledOn(every2weeks, '2026-01-05')).toBe(true)  // anchor week
    expect(isScheduledOn(every2weeks, '2026-01-12')).toBe(false) // +1 week
    expect(isScheduledOn(every2weeks, '2026-01-19')).toBe(true)  // +2 weeks
  })
})

describe('periodKey', () => {
  it('weekly keys by ISO week, monthly by calendar month, yearly by calendar year', () => {
    expect(periodKey(weekly, '2026-10-20')).toBe('2026-W43')
    expect(periodKey(monthly, '2026-10-20')).toBe('2026-10')
    expect(periodKey(yearly, '2026-10-20')).toBe('2026')
    expect(periodKey(daily, '2026-10-20')).toBe('2026-10-20')
  })
})

describe('calculateStreak — period walking visits every period exactly once', () => {
  it('monthly: a satisfied streak of N months counts N, never double-counts a long month', () => {
    // Done on the 31st of Oct, 30th of Sep, 31st of Aug. With the old fixed
    // 28-day step, stepping back from Oct 31 landed on Oct 3 — October was
    // visited (and counted) TWICE while earlier months were skipped.
    const by = comps(['2026-10-31', '2026-09-30', '2026-08-31'])
    expect(calculateStreak(habit, monthly, by, '2026-10-31')).toBe(3)
  })

  it('monthly: counts 12 consecutive satisfied months as 12', () => {
    const dates = []
    for (let m = 1; m <= 12; m++) {
      dates.push(`2026-${String(m).padStart(2, '0')}-15`)
    }
    const by = comps(dates)
    expect(calculateStreak(habit, monthly, by, '2026-12-15')).toBe(12)
  })

  it('monthly: a gap breaks the streak at the missing month', () => {
    const by = comps(['2026-10-15', '2026-08-15']) // September missed
    expect(calculateStreak(habit, monthly, by, '2026-10-15')).toBe(1)
  })

  it('monthly: the current in-progress month does not break the chain', () => {
    const by = comps(['2026-08-15', '2026-09-15']) // October not yet done
    expect(calculateStreak(habit, monthly, by, '2026-10-20')).toBe(2)
  })

  it('yearly: leap years are not double-counted', () => {
    // With the old 365-day step, stepping back from 2024-12-31 landed on
    // 2024-01-01 — the same leap year again (visited/counted twice).
    const by = comps(['2024-12-31', '2023-06-01', '2022-06-01'])
    expect(calculateStreak(habit, yearly, by, '2024-12-31')).toBe(3)
  })

  it('yearly: counts consecutive calendar years', () => {
    const by = comps(['2026-03-01', '2025-03-01', '2024-03-01'])
    expect(calculateStreak(habit, yearly, by, '2026-10-20')).toBe(3)
    const broken = comps(['2026-03-01', '2024-03-01'])
    expect(calculateStreak(habit, yearly, broken, '2026-10-20')).toBe(1)
  })

  it('weekly: still counts consecutive satisfied ISO weeks', () => {
    const by = comps(['2026-10-19', '2026-10-12', '2026-10-05'])
    expect(calculateStreak(habit, weekly, by, '2026-10-20')).toBe(3)
    const broken = comps(['2026-10-19', '2026-10-05'])
    expect(calculateStreak(habit, weekly, broken, '2026-10-20')).toBe(1)
  })

  it('twice-a-week goal needs two completions in the week', () => {
    const one = comps(['2026-10-19']) // Mon of W43
    expect(calculateStreak(habit, twiceWeekly, one, '2026-10-20')).toBe(0)
    const two = comps(['2026-10-19', '2026-10-21'])
    expect(calculateStreak(habit, twiceWeekly, two, '2026-10-20')).toBe(1)
  })

  it('every-n-weeks walks whole weeks per step', () => {
    // anchor week 2026-01-05 (W2), due weeks: W2, W4, W6 …
    const by = comps(['2026-01-06', '2026-01-20', '2026-02-03'])
    expect(calculateStreak(habit, every2weeks, by, '2026-02-03')).toBe(3)
  })
})

describe('calculateStreak — day-level cadences', () => {
  it('daily: counts consecutive done days; today pending never breaks it', () => {
    const by = comps(['2026-10-18', '2026-10-19'])
    expect(calculateStreak(habit, daily, by, '2026-10-20')).toBe(2)
    const doneToday = comps(['2026-10-18', '2026-10-19', '2026-10-20'])
    expect(calculateStreak(habit, daily, doneToday, '2026-10-20')).toBe(3)
  })

  it('weekdays: non-scheduled weekend days are skipped silently', () => {
    // Done Fri 16, Thu 15, Wed 14, Tue 13, Mon 12 (whole week) + Fri 9.
    // Walking back from pending Monday 19: weekend 17-18 skipped, all of
    // those done days count without a break.
    const by = comps(['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09'])
    expect(calculateStreak(habit, weekdays, by, '2026-10-19')).toBe(6)
    const longer = comps(['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05'])
    expect(calculateStreak(habit, weekdays, longer, '2026-10-19')).toBe(10)
  })

  it('daily with graceDays tolerates a miss and keeps counting', () => {
    const everyOther = { kind: 'every-n', interval: 2, anchorDate: '2026-10-01', graceDays: 1, timesPerPeriod: 1 }
    // due 1,3,5,7,9,11,13,15 — done all except the 9th (one tolerated miss)
    const by = comps(['2026-10-15', '2026-10-13', '2026-10-11', '2026-10-07', '2026-10-05', '2026-10-03', '2026-10-01'])
    expect(calculateStreak(habit, everyOther, by, '2026-10-16')).toBe(7)
  })

  it('daily: a miss breaks the chain at the first unsatisfied day', () => {
    const by = comps(['2026-10-22'])
    // Walking back from pending 23rd: the 22nd counts, then the missed
    // 21st breaks the chain.
    expect(calculateStreak(habit, daily, by, '2026-10-23')).toBe(1)
  })

  it('timesPerDay override raises the bar per day', () => {
    const h2 = { id: 'h1', timesPerDay: 2 }
    const oneEach = comps(['2026-10-19', '2026-10-20'])
    expect(calculateStreak(h2, daily, oneEach, '2026-10-20')).toBe(0) // each day needs 2
    const twoEach = indexCompletions([
      { id: 'a', habitId: 'h1', date: '2026-10-19' },
      { id: 'b', habitId: 'h1', date: '2026-10-19' },
      { id: 'c', habitId: 'h1', date: '2026-10-20' },
      { id: 'd', habitId: 'h1', date: '2026-10-20' }
    ])
    expect(calculateStreak(h2, daily, twoEach, '2026-10-20')).toBe(2)
  })
})

describe('evaluateHabitStatus', () => {
  it('daily status: goal/done/remaining/satisfied', () => {
    const by = comps(['2026-10-20', '2026-10-19'])
    const st = evaluateHabitStatus(habit, daily, by, '2026-10-20')
    expect(st.scheduled).toBe(true)
    expect(st.done).toBe(1)
    expect(st.goal).toBe(1)
    expect(st.satisfied).toBe(true)
  })

  it('weekly goal counts completions in the whole period', () => {
    const by = comps(['2026-10-19', '2026-10-20']) // both in ISO week 43
    const st = evaluateHabitStatus(habit, twiceWeekly, by, '2026-10-20')
    expect(st.done).toBe(2)
    expect(st.goal).toBe(2)
    expect(st.satisfied).toBe(true)
  })
})

describe('nextDueDates / describeFrequency', () => {
  it('weekly (unpinned) is due every day', () => {
    const next = nextDueDates(weekly, '2026-10-20', 3)
    expect(next).toEqual(['2026-10-20', '2026-10-21', '2026-10-22'])
  })

  it('monthly pinned lists only the pinned days', () => {
    const next = nextDueDates(monthlyPinned, '2026-10-20', 3)
    expect(next).toEqual(['2026-11-01', '2026-11-15', '2026-12-01'])
  })

  it('every-n steps by interval days', () => {
    const next = nextDueDates(every2, '2026-01-01', 3)
    expect(next).toEqual(['2026-01-01', '2026-01-03', '2026-01-05'])
  })

  it('describeFrequency renders readable cadences', () => {
    expect(describeFrequency(daily)).toBe('Every day')
    expect(describeFrequency(weekdays)).toBe('Every Mon · Tue · Wed · Thu · Fri')
    expect(describeFrequency(monthlyPinned)).toBe('Monthly on the 1st, 15th')
    expect(describeFrequency(every2)).toBe('Every 2 days')
    expect(describeFrequency(twiceWeekly)).toBe('Twice per week')
    expect(describeFrequency({ ...daily, timesPerDay: 2 })).toBe('Every day — twice a day')
  })
})

describe('calculateBestStreak', () => {
  it('finds the longest historical run even when the current streak is broken', () => {
    const dates = []
    for (let d = 1; d <= 10; d++) dates.push(`2026-10-${String(d).padStart(2, '0')}`)
    const by = comps(dates)
    expect(calculateStreak(habit, daily, by, '2026-10-20')).toBe(0) // gap since the 10th
    expect(calculateBestStreak(habit, daily, by, '2026-10-20')).toBe(10)
  })

  it('monthly best streak spans distinct months', () => {
    const by = comps(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    expect(calculateBestStreak(habit, monthly, by, '2026-10-20')).toBe(6)
  })
})
