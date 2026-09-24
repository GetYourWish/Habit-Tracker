import { describe, it, expect } from 'vitest'
import {
  fatigueMultiplier,
  calculateDayScore,
  calculateTaskScoreBreakdown,
  groupTasksByDate
} from '../src/scoring.js'

describe('fatigueMultiplier (THE canonical fatigue rule)', () => {
  it('first task of a day always gets 1.0', () => {
    expect(fatigueMultiplier(0, 0.1, 3.0)).toBe(1.0)
  })

  it('uses the multiplicative form 1.0 + i*increment', () => {
    expect(fatigueMultiplier(3, 0.1, 3.0)).toBe(1.0 + 3 * 0.1)
  })

  it('caps at fatigueCap (default 3.0 with 0.1 increments reached at i=20)', () => {
    expect(fatigueMultiplier(19, 0.1, 3.0)).toBeCloseTo(2.9, 10)
    expect(fatigueMultiplier(20, 0.1, 3.0)).toBe(3)
    expect(fatigueMultiplier(100, 0.1, 3.0)).toBe(3)
  })

  it('exact cap boundary (0.25 increments, cap 2.0 -> i=4)', () => {
    expect(fatigueMultiplier(4, 0.25, 2.0)).toBe(2)
    expect(fatigueMultiplier(5, 0.25, 2.0)).toBe(2)
  })
})

describe('calculateDayScore (canonical, migrated from additive accumulation)', () => {
  const diffs = [
    { id: 'd1', score: 1 },
    { id: 'd5', score: 5 }
  ]

  it('agrees positionally with calculateTaskScoreBreakdown (no drift)', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      id: 't' + i,
      completion: {
        completedDate: '2026-02-01',
        completedAt: `2026-02-01T0${i + 1}:00:00.000Z`,
        difficultyId: 'd5',
        categoryId: null
      }
    }))
    // Day total = sum of what each task's own breakdown would report
    const expectedTotal = tasks.reduce((sum, t) => {
      const b = calculateTaskScoreBreakdown(t, tasks, diffs, 0.25, 2.0, [])
      return sum + b.basePoints * b.fatigueMultiplier * b.priorityMultiplier
    }, 0)
    expect(calculateDayScore(tasks, diffs, 0.25, 2.0, [])).toBe(expectedTotal)
  })

  it('breaks completedAt ties by iteration order (stable sort)', () => {
    const a = { id: 'a', completion: { completedDate: '2026-02-01', completedAt: '2026-02-01T09:00:00.000Z', difficultyId: 'd1', categoryId: null } }
    const b = { id: 'b', completion: { completedDate: '2026-02-01', completedAt: '2026-02-01T09:00:00.000Z', difficultyId: 'd1', categoryId: null } }
    // [a, b]: a is position 0 (1.0), b is position 1 (1.25 with 0.25 inc)
    expect(calculateDayScore([a, b], diffs, 0.25, 2.0, [])).toBe(1 * 1.0 + 1 * 1.25)
    expect(calculateDayScore([b, a], diffs, 0.25, 2.0, [])).toBe(1 * 1.0 + 1 * 1.25)
  })

  it('applies numeric category priorityMultiplier, defaults to 1.0 otherwise', () => {
    const cats = [{ id: 'c1', priorityMultiplier: 2 }, { id: 'c2' }]
    const t1 = { id: 't1', completion: { completedDate: '2026-02-01', completedAt: '2026-02-01T09:00:00.000Z', difficultyId: 'd1', categoryId: 'c1' } }
    const t2 = { id: 't2', completion: { completedDate: '2026-02-02', completedAt: '2026-02-02T09:00:00.000Z', difficultyId: 'd1', categoryId: 'c2' } }
    expect(calculateDayScore([t1], diffs, 0.1, 3.0, cats)).toBe(2)
    expect(calculateDayScore([t2], diffs, 0.1, 3.0, cats)).toBe(1)
  })

  it('returns 0 for empty input', () => {
    expect(calculateDayScore([], diffs, 0.1, 3.0, [])).toBe(0)
    expect(calculateDayScore(null, diffs, 0.1, 3.0, [])).toBe(0)
  })
})

describe('groupTasksByDate', () => {
  it('groups by completedDate and sorts each day by completedAt', () => {
    const t1 = { id: '1', completion: { completedDate: '2026-01-01', completedAt: '2026-01-01T12:00:00.000Z' } }
    const t2 = { id: '2', completion: { completedDate: '2026-01-01', completedAt: '2026-01-01T09:00:00.000Z' } }
    const t3 = { id: '3', completion: { completedDate: '2026-01-02', completedAt: '2026-01-02T08:00:00.000Z' } }
    const grouped = groupTasksByDate([t1, t2, t3])
    expect(grouped.get('2026-01-01').map(t => t.id)).toEqual(['2', '1'])
    expect(grouped.get('2026-01-02').map(t => t.id)).toEqual(['3'])
  })
})
