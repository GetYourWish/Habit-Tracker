// Actions added for the v1.0.9 Reviews port and Settings parity — every
// transform must mirror the DESKTOP behavior exactly (same fields, same
// shapes, same side collections) so both apps keep writing byte-identical
// structures to habit.json.

import {
  updateTaskCompletion,
  addDifficulty,
  updateDifficulty,
  moveDifficulty,
  addCategory,
  updateCategory,
  moveCategory,
  clearLogs
} from '../src/actions.js'

const NOW = '2026-09-22T12:00:00.000Z'

function baseData() {
  return {
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system' },
    difficulties: [
      { id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
      { id: 'd2', label: 'Hard', score: 3, color: '#f87171', order: 1, active: true }
    ],
    categories: [
      { id: 'c1', name: 'Deep Work', color: '#8b5cf6', order: 0, active: true, priorityMultiplier: 2 },
      { id: 'c2', name: 'Admin', color: '#60a5fa', order: 1, active: true, priorityMultiplier: 1 }
    ],
    tasks: [
      {
        id: 't1',
        text: 'Shipped the fix',
        createdAt: '2026-09-20T08:00:00.000Z',
        updatedAt: '2026-09-20T08:00:00.000Z',
        completion: {
          completedDate: '2026-09-21',
          completedAt: '2026-09-21T22:45:00.000Z',
          difficultyId: 'd2',
          categoryId: 'c1',
          note: 'past midnight correction'
        }
      },
      { id: 't2', text: 'Open task', createdAt: '2026-09-21T08:00:00.000Z', updatedAt: '2026-09-21T08:00:00.000Z', completion: null }
    ],
    markers: [],
    board: [{ type: 'task', taskId: 't2' }],
    logs: [{ id: 'l1', timestamp: NOW, taskId: 't1', taskText: 'Shipped the fix', finalScore: 6 }]
  }
}

describe('updateTaskCompletion (desktop Reviews TaskDetailPopup)', () => {
  test('edits the note only — every other completion key is untouched', () => {
    const next = updateTaskCompletion(baseData(), 't1', { note: 'new note' }, NOW)
    const t = next.tasks.find(x => x.id === 't1')
    expect(t.completion.note).toBe('new note')
    expect(t.completion.completedDate).toBe('2026-09-21')
    expect(t.completion.completedAt).toBe('2026-09-21T22:45:00.000Z')
    expect(t.completion.difficultyId).toBe('d2')
    expect(t.completion.categoryId).toBe('c1')
    expect(t.updatedAt).toBe(NOW)
    expect(next.meta.updatedAt).toBe(NOW)
  })

  test('edits the completion date (worked-past-midnight correction)', () => {
    const next = updateTaskCompletion(baseData(), 't1', { completedDate: '2026-09-22' }, NOW)
    expect(next.tasks.find(x => x.id === 't1').completion.completedDate).toBe('2026-09-22')
  })

  test('edits the completion timestamp', () => {
    const next = updateTaskCompletion(baseData(), 't1', { completedAt: '2026-09-21T23:59:00.000Z' }, NOW)
    expect(next.tasks.find(x => x.id === 't1').completion.completedAt).toBe('2026-09-21T23:59:00.000Z')
  })

  test('never mutates the input', () => {
    const data = baseData()
    const before = JSON.stringify(data)
    updateTaskCompletion(data, 't1', { note: 'x' }, NOW)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('difficulty CRUD (desktop Settings Difficulties tab)', () => {
  test('addDifficulty creates the desktop default: New Difficulty / 1 / #60a5fa / order=len / active', () => {
    const next = addDifficulty(baseData(), NOW)
    const added = next.difficulties[2]
    expect(added.label).toBe('New Difficulty')
    expect(added.score).toBe(1)
    expect(added.color).toBe('#60a5fa')
    expect(added.order).toBe(2)
    expect(added.active).toBe(true)
    expect(typeof added.id).toBe('string')
  })

  test('updateDifficulty patches one field by id', () => {
    const next = updateDifficulty(baseData(), 'd2', { score: 5 }, NOW)
    expect(next.difficulties.find(d => d.id === 'd2').score).toBe(5)
    expect(next.difficulties.find(d => d.id === 'd1').score).toBe(1)
  })

  test('moveDifficulty swaps and rewrites every order value (desktop semantics)', () => {
    const next = moveDifficulty(baseData(), 'd2', 'up', NOW)
    expect(next.difficulties.map(d => d.id)).toEqual(['d2', 'd1'])
    expect(next.difficulties.map(d => d.order)).toEqual([0, 1])
  })

  test('moveDifficulty at the edge is a no-op content change (meta still bumps)', () => {
    const next = moveDifficulty(baseData(), 'd1', 'up', NOW)
    expect(next.difficulties.map(d => d.id)).toEqual(['d1', 'd2'])
  })
})

describe('category CRUD (desktop Settings Categories tab)', () => {
  test('addCategory creates the desktop default: New Category / #60a5fa / order=len / active / multiplier 1', () => {
    const next = addCategory(baseData(), NOW)
    const added = next.categories[2]
    expect(added.name).toBe('New Category')
    expect(added.color).toBe('#60a5fa')
    expect(added.order).toBe(2)
    expect(added.active).toBe(true)
    expect(added.priorityMultiplier).toBe(1)
  })

  test('updateCategory patches the priority multiplier by id', () => {
    const next = updateCategory(baseData(), 'c2', { priorityMultiplier: 1.5 }, NOW)
    expect(next.categories.find(c => c.id === 'c2').priorityMultiplier).toBe(1.5)
    expect(next.categories.find(c => c.id === 'c1').priorityMultiplier).toBe(2)
  })

  test('moveCategory swaps and rewrites order values', () => {
    const next = moveCategory(baseData(), 'c2', 'up', NOW)
    expect(next.categories.map(c => c.id)).toEqual(['c2', 'c1'])
    expect(next.categories.map(c => c.order)).toEqual([0, 1])
  })
})

describe('clearLogs (desktop Settings Logs tab)', () => {
  test('wipes the log history and nothing else', () => {
    const next = clearLogs(baseData(), NOW)
    expect(next.logs).toEqual([])
    expect(next.tasks).toHaveLength(2)
    expect(next.difficulties).toHaveLength(2)
  })
})
