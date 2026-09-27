// Actions for the habit era — every transform must mirror the DESKTOP
// behavior exactly (same fields, same shapes, same side collections) so
// both apps keep writing byte-identical structures to habit.json.
// (Successor of the task-era actions-reviews suite: difficulty/log/task
// transforms are gone with the model.)

import {
  createCategory,
  renameCategory,
  setCategoryArchived,
  updateSettings
} from '../src/actions.js'

const NOW = '2026-09-22T12:00:00.000Z'

function baseData() {
  return {
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system' },
    frequencies: [
      { id: 'f-daily', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1 }
    ],
    categories: [
      { id: 'c1', name: 'Morning', color: '#34d399', order: 0, archived: false }
    ],
    habits: [
      { id: 'h1', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: 'f-daily', categoryId: 'c1', archived: false }
    ],
    completions: [],
    board: [{ type: 'habit', habitId: 'h1' }]
  }
}

describe('createCategory (desktop HabitsView group manager)', () => {
  test('appends with defaults and stamps meta', () => {
    const next = createCategory(baseData(), { name: 'Evening', color: '#a78bfa' }, NOW)
    expect(next.categories).toHaveLength(2)
    const c = next.categories[1]
    expect(c.name).toBe('Evening')
    expect(c.color).toBe('#a78bfa')
    expect(c.order).toBe(1)
    expect(c.archived).toBe(false)
    expect(c.id).toBeTruthy()
    expect(next.meta.updatedAt).toBe(NOW)
    // input untouched
    expect(baseData().categories).toHaveLength(1)
  })
})

describe('renameCategory', () => {
  test('renames by id only', () => {
    const next = renameCategory(baseData(), 'c1', 'AM routine', NOW)
    expect(next.categories[0].name).toBe('AM routine')
    expect(next.categories[0].color).toBe('#34d399') // untouched
    expect(next.habits[0].categoryId).toBe('c1') // reference kept
  })
})

describe('setCategoryArchived', () => {
  test('flips the flag without touching habits', () => {
    const next = setCategoryArchived(baseData(), 'c1', true, NOW)
    expect(next.categories[0].archived).toBe(true)
    expect(next.habits).toHaveLength(1)
    const back = setCategoryArchived(next, 'c1', false, NOW)
    expect(back.categories[0].archived).toBe(false)
  })
})

describe('updateSettings (survivor of the task era)', () => {
  test('merges one key, keeps the rest, stamps meta', () => {
    const next = updateSettings(baseData(), { theme: 'dark' }, NOW)
    expect(next.settings.theme).toBe('dark')
    expect(next.meta.updatedAt).toBe(NOW)
    const again = updateSettings(next, { weekStartsOn: 0 }, '2026-09-22T12:01:00.000Z')
    expect(again.settings.theme).toBe('dark')
    expect(again.settings.weekStartsOn).toBe(0)
  })
})
