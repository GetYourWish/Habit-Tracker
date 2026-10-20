import { describe, it, expect } from 'vitest'
import { rebaseSaveOntoFresh } from '../src/merge.js'
import { validateAndHealData, createDefaultData } from '../src/schema.js'
import { createDefaultData as defaults } from '../src/defaults.js'

// rebaseSaveOntoFresh — the additive rebase for whole-file writers
// (SYNC-DESIGN Option A). The scenario it exists for: a phone check-in
// lands on disk inside the desktop watcher's poll latency, while the
// desktop is about to save its own edit built on a stale base. The naive
// whole-file write erases the phone's check-in; the rebase keeps both.

function comp(id, habitId, date, slot) {
  return { id, habitId, date, slot, note: '', createdAt: '2026-10-20T10:00:00.000Z' }
}

function dataWith(over = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [{ id: 'f1', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1 }],
    habits: [{ id: 'h1', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: 'f1', archived: false }],
    categories: [],
    board: [{ type: 'habit', habitId: 'h1' }],
    completions: [],
    ...over
  }
}

describe('rebaseSaveOntoFresh — completions (the additive class)', () => {
  it('keeps BOTH sides\' concurrent check-ins (the phone-clobber fix)', () => {
    const base = dataWith({ completions: [comp('c-old', 'h1', '2026-10-19')] })
    // desktop adds c-desk on top of base; phone added c-phone to the same base
    const next = dataWith({ completions: [comp('c-old', 'h1', '2026-10-19'), comp('c-desk', 'h1', '2026-10-20', 'morning')] })
    const fresh = dataWith({ completions: [comp('c-old', 'h1', '2026-10-19'), comp('c-phone', 'h1', '2026-10-20', 'evening')] })

    const merged = rebaseSaveOntoFresh(next, base, fresh)
    const ids = merged.completions.map(c => c.id).sort()
    expect(ids).toEqual(['c-desk', 'c-old', 'c-phone'])
  })

  it('an undo travels: completions the writer removed are dropped from the fresh copy too', () => {
    const base = dataWith({ completions: [comp('c1', 'h1', '2026-10-19'), comp('c2', 'h1', '2026-10-20')] })
    const next = dataWith({ completions: [comp('c1', 'h1', '2026-10-19')] }) // c2 undone by the writer
    const fresh = dataWith({ completions: [comp('c1', 'h1', '2026-10-19'), comp('c2', 'h1', '2026-10-20'), comp('c3', 'h1', '2026-10-21')] })

    const merged = rebaseSaveOntoFresh(next, base, fresh)
    expect(merged.completions.map(c => c.id).sort()).toEqual(['c1', 'c3'])
  })

  it('merged completions are in canonical (date, id) order and heal byte-identically', () => {
    // Realistic shapes: both sides are HEALED files (the only thing that can
    // be on disk), built from createDefaultData so healing is a no-op.
    const base = defaults('2026-10-01')
    const next = JSON.parse(JSON.stringify(base))
    const fresh = JSON.parse(JSON.stringify(base))
    const habitId = base.habits[0].id
    next.completions.push(comp('b-desk', habitId, '2026-10-21'))
    fresh.completions.push(comp('a-phone', habitId, '2026-10-20'))
    fresh.completions.push(comp('z-phone', habitId, '2026-10-19'))

    const merged = rebaseSaveOntoFresh(next, base, fresh)
    const tail = merged.completions.slice(-3).map(c => c.date)
    expect(tail).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
    const healed = validateAndHealData(merged)
    expect(healed).toEqual(merged)
  })

  it('a null base (first save after boot) treats every writer completion as added', () => {
    const next = dataWith({ completions: [comp('c-desk', 'h1', '2026-10-20')] })
    const fresh = dataWith({ completions: [comp('c-phone', 'h1', '2026-10-20')] })
    const merged = rebaseSaveOntoFresh(next, null, fresh)
    expect(merged.completions.map(c => c.id).sort()).toEqual(['c-desk', 'c-phone'])
  })
})

describe('rebaseSaveOntoFresh — id-keyed sections', () => {
  it('a habit created on the OTHER device survives the writer\'s save', () => {
    const base = dataWith()
    const next = dataWith({
      habits: [...dataWith().habits, { id: 'h-desk', title: 'From desktop', icon: '⭐', color: '#22d3ee', frequencyId: 'f1', archived: false }],
      board: [{ type: 'habit', habitId: 'h1' }, { type: 'habit', habitId: 'h-desk' }]
    })
    const fresh = dataWith({ habits: [...dataWith().habits, { id: 'h-phone', title: 'From phone', icon: '🌟', color: '#a78bfa', frequencyId: 'f1', archived: false }], board: [{ type: 'habit', habitId: 'h1' }, { type: 'habit', habitId: 'h-phone' }] })

    const merged = rebaseSaveOntoFresh(next, base, fresh)
    const titles = merged.habits.map(h => h.title).sort()
    expect(titles).toEqual(['Brush teeth', 'From desktop', 'From phone'])
    // the writer's board order is kept; the phone habit's row is appended
    expect(merged.board).toEqual([{ type: 'habit', habitId: 'h1' }, { type: 'habit', habitId: 'h-desk' }, { type: 'habit', habitId: 'h-phone' }])
  })

  it('a habit DELETED by the writer does not resurrect its board row from the fresh copy', () => {
    const base = dataWith({ habits: [...dataWith().habits, { id: 'h2', title: 'To delete', icon: '⭐', color: '#f00', frequencyId: 'f1', archived: false }], board: [{ type: 'habit', habitId: 'h1' }, { type: 'habit', habitId: 'h2' }] })
    const next = dataWith() // desktop deleted h2 entirely
    const fresh = base // phone still has it

    const merged = rebaseSaveOntoFresh(next, base, fresh)
    expect(merged.habits.map(h => h.id)).toEqual(['h1'])
    expect(merged.board).toEqual([{ type: 'habit', habitId: 'h1' }])
  })

  it('the writer\'s version wins for an id present on both sides (deliberate structural edit)', () => {
    const base = dataWith()
    const next = dataWith({ habits: [{ id: 'h1', title: 'Renamed by desktop', icon: '🪥', color: '#34d399', frequencyId: 'f1', archived: false }] })
    const fresh = dataWith({ habits: [{ id: 'h1', title: 'Renamed by phone', icon: '🪥', color: '#34d399', frequencyId: 'f1', archived: false }] })
    const merged = rebaseSaveOntoFresh(next, base, fresh)
    expect(merged.habits[0].title).toBe('Renamed by desktop')
  })

  it('frequencies and categories union by id as well', () => {
    const next = dataWith({
      frequencies: [...dataWith().frequencies, { id: 'f2', key: 'weekly', label: 'Weekly', kind: 'weekly', timesPerPeriod: 1 }],
      categories: [{ id: 'cat1', name: 'Desktop cat', color: '#34d399', order: 0, archived: false }]
    })
    const fresh = dataWith({
      frequencies: [...dataWith().frequencies, { id: 'f3', key: 'monthly', label: 'Monthly', kind: 'monthly', timesPerPeriod: 1 }],
      categories: [{ id: 'cat2', name: 'Phone cat', color: '#a78bfa', order: 0, archived: false }]
    })
    const merged = rebaseSaveOntoFresh(next, dataWith(), fresh)
    expect(merged.frequencies.map(f => f.id).sort()).toEqual(['f1', 'f2', 'f3'])
    expect(merged.categories.map(c => c.id).sort()).toEqual(['cat1', 'cat2'])
  })
})

describe('rebaseSaveOntoFresh — degenerate inputs', () => {
  it('no fresh data → the writer\'s save passes through untouched', () => {
    const next = dataWith({ completions: [comp('c1', 'h1', '2026-10-20')] })
    expect(rebaseSaveOntoFresh(next, dataWith(), null)).toEqual(next)
  })

  it('works on a full createDefaultData() round-trip (real-world shapes)', () => {
    const base = defaults('2026-10-01')
    const next = JSON.parse(JSON.stringify(base))
    const fresh = JSON.parse(JSON.stringify(base))
    const merged = rebaseSaveOntoFresh(next, base, fresh)
    expect(merged).toEqual(next)
  })
})
