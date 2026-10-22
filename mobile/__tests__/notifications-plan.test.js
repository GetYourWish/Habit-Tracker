// notifications-plan.test.js — the PURE planning rules of the 2026-10-22
// reminder system (mobile/src/notifications/plan.js). No native modules, no
// react-native: everything here is a function of (data, now), so the rules
// are pinned deterministically:
//   - per-habit opt-in (nothing fires by default; archived never fires)
//   - global master switch
//   - time resolution: explicit time > time-of-day slot > global default
//   - reminders ONLY on due days (weekly habits are not nagged on off days)
//   - past reminders (earlier today) are skipped
//   - a habit satisfied today skips TODAY's reminder but keeps future days
//   - the deterministic identifier contract consumed by reminders.js

import {
  computeReminderPlan,
  resolveReminderTime,
  notificationSettings,
  isValidTime,
  formatTime,
  SLOT_REMINDER_TIMES,
  PLAN_WINDOW_DAYS
} from '../src/notifications/plan.js'

const FREQ_DAILY = 'f-daily'
const FREQ_MONDAYS = 'f-mondays'

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: FREQ_DAILY, key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1 },
      { id: FREQ_MONDAYS, key: 'mondays', label: 'Every Monday', kind: 'weekly', weekdays: [1], timesPerPeriod: 1 }
    ],
    categories: [],
    habits: [],
    completions: [],
    board: [],
    logs: [],
    ...overrides
  }
}

// Fixed wall clock: Thursday 2026-10-22, 10:00 LOCAL. All expectations are
// built from the same local constructors, so the suite is timezone-agnostic.
const NOW = new Date(2026, 9, 22, 10, 0, 0, 0) // Oct 22 2026 is a Thursday
const TODAY = '2026-10-22'
const NEXT_MONDAY = '2026-10-26'

const dailyHabit = (extra = {}) => ({
  id: 'h-1',
  title: 'Brush teeth',
  icon: '🪥',
  frequencyId: FREQ_DAILY,
  archived: false,
  ...extra
})

describe('notificationSettings — global defaults', () => {
  test('absent settings default to enabled with a 09:00 default time', () => {
    const s = notificationSettings(makeData())
    expect(s).toEqual({ enabled: true, defaultTime: '09:00' })
  })

  test('an invalid stored defaultTime falls back to 09:00; enabled:false survives', () => {
    const s = notificationSettings(makeData({ settings: { notifications: { enabled: false, defaultTime: '99:99' } } }))
    expect(s).toEqual({ enabled: false, defaultTime: '09:00' })
  })

  test('a valid defaultTime is preserved', () => {
    const s = notificationSettings(makeData({ settings: { notifications: { enabled: true, defaultTime: '07:45' } } }))
    expect(s.defaultTime).toBe('07:45')
  })
})

describe('isValidTime / formatTime', () => {
  test('accepts HH:MM and H:MM within range', () => {
    expect(isValidTime('09:00')).toBe(true)
    expect(isValidTime('9:00')).toBe(true)
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('00:00')).toBe(true)
  })

  test('rejects garbage and out-of-range', () => {
    for (const bad of ['24:00', '12:60', 'banana', '', null, undefined, '9', '09:0']) {
      expect(isValidTime(bad)).toBe(false)
    }
  })

  test('formats with zero padding', () => {
    expect(formatTime(8, 5)).toBe('08:05')
    expect(formatTime(23, 0)).toBe('23:00')
  })
})

describe('resolveReminderTime — precedence', () => {
  const freq = { id: FREQ_DAILY, key: 'daily', kind: 'daily', timesPerPeriod: 1 }

  test('returns null when the habit has reminders off (or none at all)', () => {
    expect(resolveReminderTime(dailyHabit(), freq, makeData())).toBeNull()
    expect(resolveReminderTime(dailyHabit({ reminder: { enabled: false } }), freq, makeData())).toBeNull()
  })

  test('an explicit habit time wins over everything', () => {
    const h = dailyHabit({ reminder: { enabled: true, time: '06:15' }, timesOfDay: ['evening'] })
    const data = makeData({ settings: { notifications: { enabled: true, defaultTime: '12:00' } } })
    expect(resolveReminderTime(h, freq, data)).toEqual({ h: 6, m: 15 })
  })

  test('a time-of-day slot is used when no explicit time is set', () => {
    const h = dailyHabit({ reminder: { enabled: true }, timesOfDay: ['evening'] })
    expect(resolveReminderTime(h, freq, makeData())).toEqual(SLOT_REMINDER_TIMES.evening)
  })

  test('the global default applies when there is neither explicit time nor slot', () => {
    const h = dailyHabit({ reminder: { enabled: true } })
    const data = makeData({ settings: { notifications: { enabled: true, defaultTime: '07:45' } } })
    expect(resolveReminderTime(h, freq, data)).toEqual({ h: 7, m: 45 })
  })

  test('an invalid explicit time falls through to slot/default', () => {
    const h = dailyHabit({ reminder: { enabled: true, time: 'not-a-time' }, timesOfDay: ['morning'] })
    expect(resolveReminderTime(h, freq, makeData())).toEqual(SLOT_REMINDER_TIMES.morning)
  })
})

describe('computeReminderPlan — the planning rules', () => {
  test('nothing fires by default: no habit opted in', () => {
    const data = makeData({ habits: [dailyHabit(), dailyHabit({ id: 'h-2' })] })
    expect(computeReminderPlan(data, { now: NOW, today: TODAY })).toEqual([])
  })

  test('the global master switch disables everything', () => {
    const data = makeData({
      settings: { notifications: { enabled: false } },
      habits: [dailyHabit({ reminder: { enabled: true, time: '23:00' } })]
    })
    expect(computeReminderPlan(data, { now: NOW, today: TODAY })).toEqual([])
  })

  test('archived habits never remind', () => {
    const data = makeData({
      habits: [dailyHabit({ archived: true, reminder: { enabled: true, time: '23:00' } })]
    })
    expect(computeReminderPlan(data, { now: NOW, today: TODAY })).toEqual([])
  })

  test('a daily habit with a future reminder today gets today AND the following days', () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true, time: '23:00' } })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 3 })
    expect(plan.map(r => r.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24'])
    // every entry fires at 23:00 LOCAL
    for (const r of plan) {
      expect(r.at.getHours()).toBe(23)
      expect(r.at.getMinutes()).toBe(0)
      expect(r.at.getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  test("a reminder earlier than NOW skips today and starts tomorrow", () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true, time: '08:30' } })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 3 })
    expect(plan.map(r => r.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25'])
  })

  test('reminders fire ONLY on due days — a Mondays habit gets Mondays', () => {
    // TODAY is Thursday 2026-10-22; the next Monday is 2026-10-26.
    const data = makeData({
      habits: [dailyHabit({ frequencyId: FREQ_MONDAYS, reminder: { enabled: true, time: '09:00' } })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 3 })
    expect(plan.map(r => r.date)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(plan.every(r => r.date === NEXT_MONDAY || new Date(r.at).getDay() === 1)).toBe(true)
  })

  test('a habit satisfied for today skips TODAY but keeps future days', () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true, time: '23:00' } })],
      completions: [
        { id: 'c-1', habitId: 'h-1', date: TODAY, note: '', createdAt: '2026-10-22T08:00:00.000Z' }
      ]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 3 })
    expect(plan.map(r => r.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25'])
  })

  test('identifier, title and body contract (consumed by reminders.js)', () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true, time: '23:00' } })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 1 })
    expect(plan).toHaveLength(1)
    expect(plan[0].id).toBe('habit-reminder-h-1-2026-10-22')
    expect(plan[0].habitId).toBe('h-1')
    expect(plan[0].title).toBe('🪥 Brush teeth')
    expect(typeof plan[0].body).toBe('string')
    expect(plan[0].body.length).toBeGreaterThan(5)
  })

  test('window defaults to PLAN_WINDOW_DAYS and caps the plan', () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true, time: '23:00' } })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY })
    expect(plan.length).toBeLessThanOrEqual(PLAN_WINDOW_DAYS)
    // 23:00 today is still in the future → today + 29 following days
    expect(plan).toHaveLength(PLAN_WINDOW_DAYS)
  })

  test('slot-derived time: an evening habit without an explicit time reminds at 18:00', () => {
    const data = makeData({
      habits: [dailyHabit({ reminder: { enabled: true }, timesOfDay: ['evening'] })]
    })
    const plan = computeReminderPlan(data, { now: NOW, today: TODAY, windowDays: 2 })
    expect(plan.map(r => r.date)).toEqual(['2026-10-22', '2026-10-23'])
    for (const r of plan) {
      expect(r.at.getHours()).toBe(SLOT_REMINDER_TIMES.evening.h)
    }
  })

  test('garbage data yields an empty plan instead of throwing', () => {
    expect(computeReminderPlan(null)).toEqual([])
    expect(computeReminderPlan(undefined)).toEqual([])
    expect(computeReminderPlan({ habits: 'nope' })).toEqual([])
    expect(computeReminderPlan({ habits: [null, 42, {}] })).toEqual([])
  })

  test('a habit whose cadence cannot be resolved gets NO reminders (no wrong-day guessing)', () => {
    const data = makeData({
      frequencies: [],
      habits: [dailyHabit({ frequencyId: 'missing', reminder: { enabled: true, time: '23:00' } })]
    })
    expect(computeReminderPlan(data, { now: NOW, today: TODAY })).toEqual([])
  })
})
