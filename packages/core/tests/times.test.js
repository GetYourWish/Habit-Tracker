import { describe, it, expect } from 'vitest'
import {
  TIME_OF_DAY_SLOTS,
  SLOT_KEYS,
  isValidSlotKey,
  slotInfo,
  slotForHour,
  effectiveTimesPerDay,
  resolveTimesOfDay,
  countSlotDoneOnDate,
  evaluateHabitStatus,
  calculateStreak,
  describeFrequency,
  indexCompletions,
  createDefaultData
} from '../index.js'

const daily = { key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, graceDays: 0 }
const twiceDaily = { key: 'twice-daily', label: 'Twice a day', kind: 'daily', timesPerDay: 2, timesPerPeriod: 1, graceDays: 0 }
const weekly = { key: 'weekly', label: 'Once a week', kind: 'weekly', timesPerPeriod: 1, graceDays: 0 }

describe('TIME_OF_DAY_SLOTS catalog', () => {
  it('exposes the four slots in day order with icons and hour ranges', () => {
    expect(SLOT_KEYS).toEqual(['morning', 'afternoon', 'evening', 'night'])
    expect(TIME_OF_DAY_SLOTS.map(s => s.key)).toEqual(SLOT_KEYS)
    expect(TIME_OF_DAY_SLOTS.every(s => s.icon && s.label && s.color)).toBe(true)
    expect(slotInfo('morning').label).toBe('Morning')
    expect(slotInfo('nope')).toBe(null)
  })

  it('validates slot keys', () => {
    for (const k of SLOT_KEYS) expect(isValidSlotKey(k)).toBe(true)
    expect(isValidSlotKey('brunch')).toBe(false)
    expect(isValidSlotKey('')).toBe(false)
    expect(isValidSlotKey(null)).toBe(false)
    expect(isValidSlotKey(7)).toBe(false)
  })

  it('maps wall-clock hours to slots, night wrapping midnight', () => {
    expect(slotForHour(7)).toBe('morning')
    expect(slotForHour(12)).toBe('afternoon')   // 12:00 boundary
    expect(slotForHour(16)).toBe('afternoon')
    expect(slotForHour(17)).toBe('evening')     // 17:00 boundary
    expect(slotForHour(23)).toBe('night')
    expect(slotForHour(0)).toBe('night')
    expect(slotForHour(4)).toBe('night')
    expect(slotForHour(5)).toBe('morning')
  })
})

describe('effectiveTimesPerDay (habit override beats frequency default)', () => {
  it('defaults to 1 when nothing is set', () => {
    expect(effectiveTimesPerDay({}, daily)).toBe(1)
    expect(effectiveTimesPerDay({}, null)).toBe(1)
    expect(effectiveTimesPerDay(null, null)).toBe(1)
  })

  it('uses the frequency default when the habit has no override', () => {
    expect(effectiveTimesPerDay({}, twiceDaily)).toBe(2)
  })

  it('the habit override wins over the frequency default', () => {
    expect(effectiveTimesPerDay({ timesPerDay: 3 }, twiceDaily)).toBe(3)
    expect(effectiveTimesPerDay({ timesPerDay: 1 }, twiceDaily)).toBe(1)
  })

  it('clamps nonsense to sane values', () => {
    expect(effectiveTimesPerDay({ timesPerDay: 0 }, daily)).toBe(1)
    expect(effectiveTimesPerDay({ timesPerDay: -4 }, daily)).toBe(1)
    expect(effectiveTimesPerDay({ timesPerDay: 'x' }, daily)).toBe(1)
    expect(effectiveTimesPerDay({ timesPerDay: 99 }, daily)).toBe(12)
  })
})

describe('resolveTimesOfDay (the per-occurrence best-time-of-day choices)', () => {
  it('returns [] for habits with no slot preferences', () => {
    expect(resolveTimesOfDay({}, daily)).toEqual([])
    expect(resolveTimesOfDay(null, daily)).toEqual([])
    expect(resolveTimesOfDay({ timesOfDay: [] }, daily)).toEqual([])
  })

  it('keeps valid slots in declared order (brushing: morning then evening)', () => {
    const habit = { timesOfDay: ['evening', 'morning'] }
    expect(resolveTimesOfDay(habit, twiceDaily)).toEqual(['evening', 'morning'])
  })

  it('normalizes invalid keys to null (an anytime occurrence) and caps at per-day', () => {
    const habit = { timesPerDay: 3, timesOfDay: ['morning', 'brunch', 'night', 'evening'] }
    expect(resolveTimesOfDay(habit, daily)).toEqual(['morning', null, 'night'])
  })

  it('mixing a set time with anytime keeps the null entry', () => {
    const habit = { timesPerDay: 2, timesOfDay: ['morning', null] }
    expect(resolveTimesOfDay(habit, daily)).toEqual(['morning', null])
  })

  it('an all-null list collapses to [] (slotless habit)', () => {
    const habit = { timesPerDay: 2, timesOfDay: [null, null] }
    expect(resolveTimesOfDay(habit, daily)).toEqual([])
  })

  it('drops entries beyond the effective per-day count', () => {
    const habit2 = { timesPerDay: 1, timesOfDay: ['morning', 'evening'] }
    expect(resolveTimesOfDay(habit2, daily)).toEqual(['morning'])
  })

  it('evaluateHabitStatus ignores null entries in its slots report', () => {
    const habit = { id: 'h1', timesPerDay: 2, timesOfDay: ['morning', null] }
    const byHabit = { h1: [{ id: 'c1', habitId: 'h1', date: '2026-01-08', slot: 'morning' }] }
    const st = evaluateHabitStatus(habit, daily, byHabit, '2026-01-08')
    expect(st.slots).toEqual([{ key: 'morning', done: 1, satisfied: true }])
  })
})

describe('evaluateHabitStatus with time-of-day slots', () => {
  const today = '2026-01-08'

  it('goal reflects the habit timesPerDay override', () => {
    const habit = { id: 'h1', timesPerDay: 3 }
    const st = evaluateHabitStatus(habit, daily, {}, today)
    expect(st.perDay).toBe(3)
    expect(st.goal).toBe(3)
  })

  it('per-day override works inside weekly cadences too', () => {
    const habit = { id: 'h1', timesPerDay: 2 }
    const st = evaluateHabitStatus(habit, weekly, {}, today)
    expect(st.goal).toBe(2) // weekly: 1 × perPeriod × 2 per day for today's view
  })

  it('reports per-slot done/satisfied so the Today page can check each occurrence', () => {
    const habit = { id: 'h1', timesOfDay: ['morning', 'evening'] }
    const byHabit = {
      h1: [
        { id: 'c1', habitId: 'h1', date: today, slot: 'morning' },
        { id: 'c2', habitId: 'h1', date: today } // anytime completion
      ]
    }
    const st = evaluateHabitStatus(habit, twiceDaily, byHabit, today)
    expect(st.done).toBe(2)
    expect(st.goal).toBe(2)
    expect(st.satisfied).toBe(true)
    expect(st.slots).toEqual([
      { key: 'morning', done: 1, satisfied: true },
      { key: 'evening', done: 0, satisfied: false }
    ])
  })

  it('counts slotless completions toward done but not toward any slot', () => {
    const habit = { id: 'h1', timesOfDay: ['morning', 'evening'] }
    const byHabit = { h1: [{ id: 'c1', habitId: 'h1', date: today }] }
    const st = evaluateHabitStatus(habit, twiceDaily, byHabit, today)
    expect(st.done).toBe(1)
    expect(st.slots.every(s => s.satisfied === false)).toBe(true)
  })

  it('returns empty slots for habits without slot preferences', () => {
    const st = evaluateHabitStatus({ id: 'h1' }, daily, {}, today)
    expect(st.slots).toEqual([])
    expect(st.perDay).toBe(1)
  })

  it('countSlotDoneOnDate counts only matching slot on the date', () => {
    const habit = { id: 'h1' }
    const completions = [
      { habitId: 'h1', date: today, slot: 'morning' },
      { habitId: 'h1', date: today, slot: 'morning' },
      { habitId: 'h1', date: today, slot: 'evening' },
      { habitId: 'h1', date: '2026-01-07', slot: 'morning' }
    ]
    expect(countSlotDoneOnDate(habit, completions, today, 'morning')).toBe(2)
    expect(countSlotDoneOnDate(habit, completions, today, 'evening')).toBe(1)
    expect(countSlotDoneOnDate(habit, completions, '2026-01-07', 'morning')).toBe(1)
  })
})

describe('calculateStreak honors the per-day override', () => {
  const today = '2026-01-05'

  it('a 3x/day habit needs 3 completions a day to keep its streak', () => {
    const habit = { id: 'h1', timesPerDay: 3 }
    const byHabit = {
      h1: [
        { id: 'a', habitId: 'h1', date: '2026-01-05' },
        { id: 'b', habitId: 'h1', date: '2026-01-04' },
        { id: 'c', habitId: 'h1', date: '2026-01-04' },
        { id: 'd', habitId: 'h1', date: '2026-01-04' }
      ]
    }
    // 4th fully done; 5th pending (today never breaks) → streak 1
    expect(calculateStreak(habit, daily, byHabit, today)).toBe(1)
  })

  it('without the override the frequency default applies (2 for twice-daily)', () => {
    const byHabit = {
      h1: [
        { id: 'a', habitId: 'h1', date: '2026-01-05' },
        { id: 'b', habitId: 'h1', date: '2026-01-04' },
        { id: 'c', habitId: 'h1', date: '2026-01-04' },
        { id: 'd', habitId: 'h1', date: '2026-01-03' },
        { id: 'e', habitId: 'h1', date: '2026-01-03' }
      ]
    }
    // Jan 5 (today) pending, Jan 4 satisfied (2×), Jan 3 satisfied (2×)
    expect(calculateStreak({ id: 'h1' }, twiceDaily, byHabit, today)).toBe(2)
  })
})

describe('describeFrequency with habit overrides', () => {
  it('describes the frequency alone when no habit is passed', () => {
    expect(describeFrequency(twiceDaily)).toBe('Every day — twice a day')
    expect(describeFrequency(daily)).toBe('Every day')
  })

  it('reflects the habit per-day override', () => {
    expect(describeFrequency(daily, { timesPerDay: 3 })).toBe('Every day — thrice a day')
    expect(describeFrequency(daily, { timesPerDay: 2 })).toBe('Every day — twice a day')
    expect(describeFrequency(daily, { timesPerDay: 7 })).toBe('Every day — 7 times a day')
  })

  it('a habit override of 1 silences the per-day suffix', () => {
    expect(describeFrequency(twiceDaily, { timesPerDay: 1 })).toBe('Every day')
  })
})

describe('createDefaultData seeds slot-aware starter habits', () => {
  it('brushes teeth twice a day, morning and evening', () => {
    const data = createDefaultData('2026-01-08')
    const brush = data.habits.find(h => h.title === 'Brush teeth')
    expect(brush).toBeTruthy()
    const freq = data.frequencies.find(f => f.id === brush.frequencyId)
    expect(freq.key).toBe('twice-daily')
    expect(resolveTimesOfDay(brush, freq)).toEqual(['morning', 'evening'])
  })

  it('drinks water 3 times a day across the three daylight slots', () => {
    const data = createDefaultData('2026-01-08')
    const water = data.habits.find(h => h.title === 'Drink water')
    expect(water.timesPerDay).toBe(3)
    expect(water.timesOfDay).toEqual(['morning', 'afternoon', 'evening'])
  })

  it('seeded completions for slotted habits carry slot values', () => {
    const data = createDefaultData('2026-01-08')
    const brush = data.habits.find(h => h.title === 'Brush teeth')
    const seeded = data.completions.filter(c => c.habitId === brush.id)
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.every(c => c.slot === 'morning' || c.slot === 'evening')).toBe(true)
  })

  it('seeding is deterministic', () => {
    expect(JSON.stringify(createDefaultData('2026-01-08'))).toBe(JSON.stringify(createDefaultData('2026-01-08')))
  })

  it('indexCompletions still groups by habit for slot-aware rows', () => {
    const data = createDefaultData('2026-01-08')
    const byHabit = indexCompletions(data.completions)
    for (const h of data.habits) {
      expect(Array.isArray(byHabit[h.id])).toBe(true)
    }
  })
})
