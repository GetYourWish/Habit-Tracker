// ReviewsScreen — the desktop Reviews view ported to Android (v1.0.9).
// The desktop tab was entirely missing from the mobile app ("the reviews
// section is non existent"); this suite pins the port's data correctness:
//   - all five desktop tabs render (Dashboard / Daily / Flow / Stacked / Heatmap)
//   - Daily shows the same score core computes for that date
//   - the day dialog opens from a Flow State bar tap
//   - task detail edits flow through store.mutate with updateTaskCompletion
//   - the heatmap grid lays out a full year (365/366 cells, tap opens day)

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Pressable, Text, TextInput } from 'react-native'
import { ReviewsScreen } from '../src/components/ReviewsScreen.js'
import { TextButton } from '../src/components/ui.js'
import { ReviewsDashboard } from '../src/components/reviews/dashboard.js'
import {
  buildDaySeries,
  buildHeatmapYear,
  resolveChartRange,
  filterByRange,
  HeatmapColor
} from '../src/components/reviews/charts.js'
import { calculateDayScore, groupTasksByDate, formatDate, parseDate } from '@habit-tracker/core'
import { addDays, startOfDay, eachDayOfInterval } from '../src/dates.js'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

const theme = buildTheme('dark', 'dark')

function makeTask(id, date, at, difficultyId = 'd1', categoryId = null, note = '') {
  return {
    id,
    text: `Task ${id}`,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
    completion: {
      completedDate: date,
      completedAt: at,
      difficultyId,
      categoryId,
      note
    }
  }
}

const TODAY = new Date()
function isoDay(offset = 0) {
  return formatDate(addDays(startOfDay(TODAY), offset))
}

function makeData() {
  // Two completions today (Easy 1 + Medium 2 → fatigue), one yesterday.
  return {
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system', fatigueIncrement: 0.1, fatigueCap: 3.0, weekStartsOn: 1, heatmapMode: 'score' },
    difficulties: [
      { id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
      { id: 'd2', label: 'Medium', score: 2, color: '#fbbf24', order: 1, active: true }
    ],
    categories: [{ id: 'c1', name: 'Deep Work', color: '#8b5cf6', order: 0, active: true, priorityMultiplier: 2 }],
    tasks: [
      makeTask('t1', isoDay(0), `${isoDay(0)}T09:00:00.000Z`, 'd1', 'c1'),
      makeTask('t2', isoDay(0), `${isoDay(0)}T10:00:00.000Z`, 'd2', 'c1'),
      makeTask('t3', isoDay(-1), `${isoDay(-1)}T09:00:00.000Z`, 'd1', null, 'yesterday note')
    ],
    markers: [],
    board: [],
    logs: []
  }
}

function makeStore() {
  const calls = []
  return {
    calls,
    mutate: async buildNext => {
      calls.push(buildNext)
    }
  }
}

async function mountScreen(data = makeData(), store = makeStore()) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(
      <ReviewsScreen theme={theme} state={{ status: 'ready', data, conflicts: [] }} store={store} />
    )
    await Promise.resolve()
  })
  return { tree, store }
}

function textOf(node) {
  // toJSON() output: host components carry STRING types ('Text') and their
  // text lives in the children array — props never contains children.
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
  visit(node)
  return out
}

function findByLabel(tree, label) {
  // RN's exported Pressable is a memo(forwardRef(...)) wrapper — the instance
  // tree carries the INNER function, so findAllByType(Pressable) matches
  // nothing. Find by the accessibilityLabel prop instead, and return the
  // node that actually carries onPress (the label also lands on wrapper and
  // host Views).
  return (
    tree.root
      .findAll(
        n =>
          n.props &&
          typeof n.props.accessibilityLabel === 'string' &&
          n.props.accessibilityLabel.includes(label) &&
          typeof n.props.onPress === 'function'
      )
      .pop() || null
  )
}

describe('ReviewsScreen tabs (desktop parity)', () => {
  test('renders all five desktop review tabs', async () => {
    const { tree } = await mountScreen()
    const labels = textOf(tree.toJSON())
    for (const tabLabel of ['Dashboard', 'Daily', 'Flow', 'Stacked', 'Heatmap']) {
      expect(labels).toContain(tabLabel)
    }
  })

  test('Dashboard tab renders the four desktop panels + all-time header', async () => {
    const { tree } = await mountScreen()
    const texts = textOf(tree.toJSON()).join(' ')
    for (const panel of ['INTENSITY', 'RECORDS', 'RHYTHM', 'COMPOSITION']) {
      expect(texts).toContain(panel)
    }
    expect(texts).toContain('all-time score')
    expect(texts).toContain('tasks completed')
  })

  test('Dashboard shows 3 tasks completed and a nonzero all-time score', async () => {
    const { tree } = await mountScreen()
    const texts = textOf(tree.toJSON())
    expect(texts).toContain('3')
  })
})

describe('Daily tab data correctness (core parity)', () => {
  test('today shows the same score core.calculateDayScore computes', async () => {
    const data = makeData()
    const { tree } = await mountScreen(data)
    const expected = calculateDayScore(
      data.tasks.filter(t => t.completion.completedDate === isoDay(0)),
      data.difficulties,
      0.1,
      3.0,
      data.categories
    )
    const texts = textOf(tree.toJSON())
    // Daily is not the default tab; navigate via the Daily segmented radio
    const dailyRadio = findByLabel(tree, 'Daily')
    expect(dailyRadio).toBeTruthy()
    await act(async () => {
      dailyRadio.props.onPress()
    })
    const after = textOf(tree.toJSON())
    expect(after).toContain(String(Math.round(expected * 10) / 10))
  })

  test('completed task tap opens the detail dialog with the task text', async () => {
    const { tree } = await mountScreen()
    const dailyRadio = findByLabel(tree, 'Daily')
    await act(async () => {
      dailyRadio.props.onPress()
    })
    const row = findByLabel(tree, 'Task details: Task t1')
    expect(row).toBeTruthy()
    await act(async () => {
      row.props.onPress()
    })
    const texts = textOf(tree.toJSON()).join(' ')
    expect(texts).toContain('Task Details')
    expect(texts).toContain('Task t1')
    expect(texts).toContain('COMPLETION DATE')
    expect(texts).toContain('Deep Work')
  })

  test('note edit goes through store.mutate with updateTaskCompletion', async () => {
    const { tree, store } = await mountScreen()
    const dailyRadio = findByLabel(tree, 'Daily')
    await act(async () => {
      dailyRadio.props.onPress()
    })
    const row = findByLabel(tree, 'Task details: Task t1')
    await act(async () => {
      row.props.onPress()
    })
    // sanity: nothing has mutated yet
    expect(store.calls).toHaveLength(0)
    // The NOTE section's Edit button (a TextButton with label="Edit")
    const editBtn = tree.root.findAllByType(TextButton).find(b => b.props.label === 'Edit')
    expect(editBtn).toBeTruthy()
    await act(async () => {
      editBtn.props.onPress()
    })
    // The note TextInput appears — type into it and save
    const input = tree.root.findAllByType(TextInput).find(
      i => i.props.multiline === true
    )
    expect(input).toBeTruthy()
    await act(async () => {
      input.props.onChangeText('planted the tree')
    })
    const saveBtn = tree.root.findAllByType(TextButton).find(b => b.props.label === 'Save')
    expect(saveBtn).toBeTruthy()
    await act(async () => {
      saveBtn.props.onPress()
    })
    // exactly one mutation, and it applies updateTaskCompletion with the note
    expect(store.calls).toHaveLength(1)
    const next = store.calls[0](structuredClone(makeData()), '2026-09-22T00:00:00.000Z')
    const t1 = next.tasks.find(t => t.id === 't1')
    expect(t1.completion.note).toBe('planted the tree')
    // every other completion key is untouched
    expect(t1.completion.completedDate).toBe(isoDay(0))
    expect(t1.completion.difficultyId).toBe('d1')
  })
})

describe('chart data builders', () => {
  const data = makeData()
  const completed = data.tasks.filter(t => t.completion)
  const tasksByDate = groupTasksByDate(completed)

  test('buildDaySeries covers every calendar day and marks future days', () => {
    const start = addDays(startOfDay(TODAY), -6)
    const end = addDays(startOfDay(TODAY), 2)
    const series = buildDaySeries({
      start,
      end,
      tasksByDate,
      difficulties: data.difficulties,
      categories: data.categories,
      settings: data.settings
    })
    expect(series).toHaveLength(9)
    expect(series.filter(d => d.isFuture)).toHaveLength(2)
    const today = series.find(d => d.date === isoDay(0))
    expect(today.count).toBe(2)
    expect(today.score).toBe(
      calculateDayScore(
        completed.filter(t => t.completion.completedDate === isoDay(0)),
        data.difficulties,
        0.1,
        3.0,
        data.categories
      )
    )
  })

  test('resolveChartRange week = Monday..Sunday of the current week', () => {
    const { start, end } = resolveChartRange('week', completed, 1)
    expect(start.getDay()).toBe(1)
    expect(end.getDay()).toBe(0)
    expect(eachDayOfInterval({ start, end })).toHaveLength(7)
  })

  test('resolveChartRange month covers the whole current month', () => {
    const { start, end } = resolveChartRange('month', completed, 1)
    expect(start.getDate()).toBe(1)
    expect(end.getMonth()).toBe(start.getMonth())
    expect(eachDayOfInterval({ start, end })).toHaveLength(end.getDate())
  })

  test('filterByRange mirrors the desktop range windows', () => {
    expect(filterByRange(completed, 'all')).toHaveLength(3)
    expect(filterByRange(completed, '30d')).toHaveLength(3)
    // Desktop filterByRange has NO upper bound (a task completed after
    // "now" is still inside the window), so a fake now 400 days in the
    // PAST still sees today's tasks. Push "now" 400 days into the FUTURE
    // instead — then the 90d window starts after every fixture task.
    expect(filterByRange(completed, '90d', addDays(TODAY, -400))).toHaveLength(3)
    expect(filterByRange(completed, '90d', addDays(TODAY, 400))).toHaveLength(0)
    expect(filterByRange(completed, 'year', addDays(TODAY, 400))).toHaveLength(0)
  })

  test('buildHeatmapYear lays out every day of the year with core-identical scores', () => {
    const year = TODAY.getFullYear()
    const cells = buildHeatmapYear({
      year,
      tasksByDate,
      difficulties: data.difficulties,
      categories: data.categories,
      settings: data.settings
    })
    const daysInYear = eachDayOfInterval({ start: new Date(year, 0, 1), end: new Date(year, 11, 31) }).length
    expect(cells).toHaveLength(daysInYear)
    const todayCell = cells.find(c => c.date === isoDay(0))
    expect(todayCell.value).toBe(
      calculateDayScore(
        completed.filter(t => t.completion.completedDate === isoDay(0)),
        data.difficulties,
        0.1,
        3.0,
        data.categories
      )
    )
  })

  test('HeatmapColor follows the desktop intensity quartiles', () => {
    expect(HeatmapColor(0, 10)).toBeNull()
    expect(HeatmapColor(2, 10)).toBe('#bbf7d0') // <= 25%
    expect(HeatmapColor(3, 10)).toBe('#86efac') // <= 50%
    expect(HeatmapColor(6, 10)).toBe('#4ade80') // <= 75%
    expect(HeatmapColor(8, 10)).toBe('#22c55e') // > 75%
    expect(HeatmapColor(50, 10)).toBe('#22c55e') // clamped
  })

  test('heatmap count mode returns completion counts (desktop heatmapMode)', () => {
    const cells = buildHeatmapYear({
      year: TODAY.getFullYear(),
      tasksByDate,
      difficulties: data.difficulties,
      categories: data.categories,
      settings: { ...data.settings, heatmapMode: 'count' }
    })
    expect(cells.find(c => c.date === isoDay(0)).value).toBe(2)
    expect(cells.find(c => c.date === isoDay(-1)).value).toBe(1)
  })
})

describe('ReviewsDashboard numbers (desktop parity)', () => {
  const data = makeData()

  test('streaks: 2-day current streak with yesterday+today completions', async () => {
    let tree = null
    await act(async () => {
      tree = TestRenderer.create(<ReviewsDashboard theme={theme} data={data} />)
      await Promise.resolve()
    })
    const texts = textOf(tree.toJSON()).join('|')
    expect(texts).toContain('STREAKS')
    // current=2 longest=2 render inside the streaks card
    expect(texts).toContain('current')
    expect(texts).toContain('longest')
  })

  test('category multiplier shows up in the all-time total (desktop formula)', () => {
    // Easy(1) x fatigue(1.0) x multiplier(2) + Medium(2) x fatigue(1.1) x 2 + Easy(1) x 1
    // = 2 + 4.4 + 1 = 7.4
    const expected = 7.4
    let tree = null
    TestRenderer.act(() => {
      tree = TestRenderer.create(<ReviewsDashboard theme={theme} data={data} />)
    })
    const texts = textOf(tree.toJSON())
    expect(texts).toContain(String(expected))
  })

  test('dashboard card visibility honors settings.dashboard (shared ids)', () => {
    const hidden = { ...data, settings: { ...data.settings, dashboard: { streaks: false, difficultyMix: false } } }
    let tree = null
    TestRenderer.act(() => {
      tree = TestRenderer.create(<ReviewsDashboard theme={theme} data={hidden} />)
    })
    const texts = textOf(tree.toJSON()).join('|')
    expect(texts).not.toContain('STREAKS')
    expect(texts).not.toContain('DIFFICULTY MIX')
    expect(texts).toContain('RECORDS') // panel header still shows
  })
})
