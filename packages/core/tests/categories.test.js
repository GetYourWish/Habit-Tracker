import { describe, it, expect } from 'vitest'
import { getTaskCategory } from '../src/categories.js'

const categories = [
  { id: 'cat-a', name: 'A', color: '#111' },
  { id: 'cat-b', name: 'B', color: '#222' }
]
const markers = [
  { id: 'm1', categoryId: 'cat-a' },
  { id: 'm2', categoryId: 'cat-a' },
  { id: 'm3', categoryId: 'cat-b' }
]
// Board: [mA, task, mA, task, mB]
const board = [
  { type: 'marker', markerId: 'm1' },
  { type: 'task', taskId: 't1' },
  { type: 'marker', markerId: 'm2' },
  { type: 'task', taskId: 't2' },
  { type: 'marker', markerId: 'm3' }
]

describe('getTaskCategory — strict marker-above+marker-below rule', () => {
  it('resolves the category through markerId -> marker entity (regression: never reads board-item categoryId)', () => {
    // t1 sits between m1 and m2, both cat-a
    expect(getTaskCategory(1, board, markers, categories)).toEqual(categories[0])
  })

  it('returns null when above and below markers reference different categories', () => {
    // t2: above m2 (cat-a), below m3 (cat-b)
    expect(getTaskCategory(3, board, markers, categories)).toBeNull()
  })

  it('returns null without a marker below', () => {
    expect(getTaskCategory(3, board.slice(0, 4), markers, categories)).toBeNull()
  })

  it('returns null without a marker above', () => {
    expect(getTaskCategory(0, board, markers, categories)).toBeNull()
  })

  it('returns null when a referenced marker entity is missing', () => {
    const broken = [
      { type: 'marker', markerId: 'ghost' },
      { type: 'task', taskId: 't1' },
      { type: 'marker', markerId: 'm2' }
    ]
    expect(getTaskCategory(1, broken, markers, categories)).toBeNull()
  })

  it('regression lock: the broken pre-fix implementation would have returned null for the matching pair too', () => {
    // Documents the 2026-08 fix: board items only carry markerId, so reading
    // .categoryId off them compared undefined === undefined and then looked
    // up a category with id undefined -> always null. The rule must resolve
    // through the markers list.
    const cat = getTaskCategory(1, board, markers, categories)
    expect(cat).not.toBeNull()
    expect(cat.id).toBe('cat-a')
  })
})
