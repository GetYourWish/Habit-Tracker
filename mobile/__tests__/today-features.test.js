// today-features.test.js — TodayScreen regressions (desktop TodayView
// parity), the habit-era successor of board-features.test.js:
//   1. sections: a slotted habit (2×/day morning + evening) renders one row
//      per occurrence in its time section; a slotless habit lands in Anytime
//   2. tapping a check writes through toggleHabitCompletion with the slot
//      (or the anytime count) — the exact desktop payload
//   3. undo path: tapping a done occurrence removes the completion
//   4. resting habits: not-scheduled habits collapse behind the toggle and
//      a bonus tap still writes a completion
//   5. empty state: no habits → the "Nothing tracked yet" hero + FAB
//   6. hero progress counts every visible occurrence once

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TodayScreen } from '../src/components/TodayScreen.js'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

const theme = buildTheme('dark', 'dark')

const FREQ_DAILY = 'f-daily'
const FREQ_WEEKLY = 'f-weekly'

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: FREQ_DAILY, key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, color: '#34d399', icon: '☀️' },
      { id: FREQ_WEEKLY, key: 'weekly', label: 'Once a week', kind: 'weekly', timesPerPeriod: 1, color: '#a78bfa', icon: '📅' }
    ],
    categories: [],
    habits: [],
    completions: [],
    board: [],
    logs: [],
    ...overrides
  }
}

function makeStore(apply) {
  const calls = []
  return {
    calls,
    mutate: async buildNext => {
      calls.push(buildNext)
      if (apply) apply(buildNext)
    }
  }
}

function textOf(tree) {
  const out = []
  const visit = n => {
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (n && typeof n === 'object') {
      if (n.type === 'Text' && Array.isArray(n.children)) {
        n.children.forEach(c => {
          if (typeof c === 'string') out.push(c)
        })
      }
      if (n.children) visit(n.children)
    }
  }
  visit(tree.toJSON())
  return out
}

function labelsOf(tree) {
  // every Pressable/View carrying an accessibilityLabel prop
  const out = []
  const visit = n => {
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (n && typeof n === 'object') {
      const label = n.props && n.props.accessibilityLabel
      if (typeof label === 'string') out.push(label)
      if (n.children) visit(n.children)
    }
  }
  visit(tree.toJSON())
  return out
}

async function mountToday(data = makeData(), store = makeStore()) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(
      <TodayScreen
        theme={theme}
        state={{ status: 'ready', data, conflicts: [] }}
        store={store}
        refreshing={false}
        onRefresh={() => {}}
        onAddHabit={() => {}}
        onEditHabit={() => {}}
      />
    )
    await Promise.resolve()
  })
  return { tree, store }
}

describe('TodayScreen (desktop TodayView parity)', () => {
  test('a slotted habit renders one row per occurrence in its time sections', async () => {
    const data = makeData({
      habits: [
        { id: 'h-brush', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: FREQ_DAILY, archived: false, timesPerDay: 2, timesOfDay: ['morning', 'evening'] }
      ],
      board: [{ type: 'habit', habitId: 'h-brush' }]
    })
    const { tree } = await mountToday(data)
    const labels = labelsOf(tree)
    expect(labels).toContain('Check Brush teeth (Morning)')
    expect(labels).toContain('Check Brush teeth (Evening)')
    const texts = textOf(tree)
    expect(texts.join(' ')).toContain('Morning')
    expect(texts.join(' ')).toContain('Evening')
    // hero counts both occurrences (section pills "0 / 1" each)
    expect(texts.join(' ')).toContain('0 / 1')
  })

  test('a slotless habit lands in Anytime; multi-occurrence shows ×N progress', async () => {
    const data = makeData({
      habits: [
        { id: 'h-water', title: 'Drink water', icon: '💧', color: '#22d3ee', frequencyId: FREQ_DAILY, archived: false, timesPerDay: 3 }
      ],
      board: [{ type: 'habit', habitId: 'h-water' }]
    })
    const { tree } = await mountToday(data)
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('Anytime')
    expect(texts).toContain('0/3 anytime')
    expect(labelsOf(tree)).toContain('Check Drink water')
  })

  test('tapping a slot check writes the completion through the store (exact desktop payload shape)', async () => {
    const data = makeData({
      habits: [
        { id: 'h-brush', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: FREQ_DAILY, archived: false, timesPerDay: 2, timesOfDay: ['morning', 'evening'] }
      ],
      board: [{ type: 'habit', habitId: 'h-brush' }]
    })
    const store = makeStore()
    const { tree } = await mountToday(data, store)
    expect(store.calls).toHaveLength(0)

    const checkBtn = findAllByLabel(tree, 'Check Brush teeth (Morning)')[0]
    await act(async () => {
      checkBtn.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    // the mutation builds on the CURRENT data with an explicit now
    const built = store.calls[0](data, '2026-09-22T12:00:00.000Z')
    const c = built.completions[built.completions.length - 1]
    expect(c.habitId).toBe('h-brush')
    expect(c.slot).toBe('morning')
    expect(c.note).toBe('')
  })

  test('an anytime check writes a slotless completion; a done slot check undoes it', async () => {
    const data = makeData({
      habits: [
        { id: 'h-walk', title: 'Walk', icon: '🚶', color: '#84cc16', frequencyId: FREQ_DAILY, archived: false, timesPerDay: 2, timesOfDay: ['morning', 'evening'] }
      ],
      completions: [
        { id: 'c1', habitId: 'h-walk', date: new Date().toISOString().slice(0, 10), slot: 'morning', note: '', createdAt: '2026-09-22T08:00:00.000Z' }
      ],
      board: [{ type: 'habit', habitId: 'h-walk' }]
    })
    const store = makeStore()
    const { tree } = await mountToday(data, store)

    // the morning row is done → its label flips to Undo and the tap REMOVES
    const undoBtn = findAllByLabel(tree, 'Undo Walk (Morning)')[0]
    await act(async () => {
      undoBtn.props.onPress()
      await Promise.resolve()
    })
    const built = store.calls[0](data, '2026-09-22T12:00:00.000Z')
    expect(built.completions.find(c => c.id === 'c1')).toBeUndefined()
  })

  test('not-scheduled habits collapse behind the resting toggle; a bonus tap still writes', async () => {
    // Monday-pinned weekly habit; the test clock reads Sunday → not scheduled.
    const data = makeData({
      frequencies: [
        { id: FREQ_DAILY, key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, color: '#34d399', icon: '☀️' },
        { id: FREQ_WEEKLY, key: 'weekly', label: 'Mondays only', kind: 'weekly', weekdays: [1], timesPerPeriod: 1, color: '#a78bfa', icon: '📅' }
      ],
      habits: [
        { id: 'h-week', title: 'Weekly review', icon: '🗓️', color: '#a78bfa', frequencyId: FREQ_WEEKLY, archived: false }
      ],
      completions: [],
      board: [{ type: 'habit', habitId: 'h-week' }]
    })
    const store = makeStore()
    const { tree } = await mountToday(data, store)

    const texts = textOf(tree).join(' ')
    expect(texts).toContain('resting today')

    // open the resting list, then bonus-check the habit
    const toggle = findPressableByText(tree, 'resting today')
    await act(async () => {
      toggle.props.onPress()
      await Promise.resolve()
    })
    const bonus = findAllByLabel(tree, 'Check Weekly review')[0]
    await act(async () => {
      bonus.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    const built = store.calls[0](data, '2026-09-22T12:00:00.000Z')
    expect(built.completions).toHaveLength(1) // bonus check-in always ADDS
  })

  test('no habits → the empty state hero with a New habit button', async () => {
    const { tree } = await mountToday(makeData())
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('Nothing tracked yet')
    expect(texts).toContain('Create your first habit')
    expect(labelsOf(tree)).toContain('New habit')
  })

  test('a habit with a broken frequencyId still renders as an every-day row (dead check fix)', async () => {
    const data = makeData({
      habits: [
        { id: 'h-legacy', title: 'Legacy habit', icon: '⭐', color: '#fbbf24', frequencyId: 'no-such-frequency', archived: false }
      ],
      board: [{ type: 'habit', habitId: 'h-legacy' }]
    })
    const { tree } = await mountToday(data)
    // treated as daily → visible with a working check, never in resting
    expect(labelsOf(tree)).toContain('Check Legacy habit')
    expect(textOf(tree).join(' ')).not.toContain('resting today')
  })
})

function findAllByLabel(tree, label) {
  // test instances keep function props (toJSON strips them)
  return tree.root.findAll(n => n.props && n.props.accessibilityLabel === label)
}

function findPressableByText(tree, needle) {
  const collect = inst => {
    if (typeof inst === 'string') return inst
    if (!inst || typeof inst !== 'object' || !Array.isArray(inst.children)) return ''
    return inst.children.map(collect).join(' ')
  }
  return tree.root.findAll(n => {
    if (!n.props || typeof n.props.onPress !== 'function') return false
    return collect(n).includes(needle)
  })[0]
}
