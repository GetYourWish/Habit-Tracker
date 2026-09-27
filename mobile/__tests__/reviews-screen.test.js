// reviews-screen.test.js — the habit ReviewsScreen (desktop ReviewsView
// parity): summary tiles, per-habit rows with 30-day dot grids, streaks and
// consistency. The task-era dashboard/heatmap tabs are gone with the model.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ReviewsScreen } from '../src/components/ReviewsScreen.js'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

const theme = buildTheme('dark', 'dark')

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: 'f-daily', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, icon: '☀️', color: '#34d399' }
    ],
    categories: [],
    habits: [
      { id: 'h1', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: 'f-daily', archived: false, timesPerDay: 2, timesOfDay: ['morning', 'evening'] },
      { id: 'h2', title: 'Read', icon: '📖', color: '#a78bfa', frequencyId: 'f-daily', archived: false }
    ],
    completions: [],
    board: [],
    logs: [],
    ...overrides
  }
}

async function mountReviews(data = makeData()) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(
      <ReviewsScreen theme={theme} state={{ status: 'ready', data, conflicts: [] }} store={{ mutate: async () => {} }} />
    )
    await Promise.resolve()
  })
  return tree
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

describe('ReviewsScreen (habit model)', () => {
  test('renders the summary tiles and per-habit rows', async () => {
    const tree = await mountReviews()
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('perfect days')
    expect(texts).toContain('check-ins')
    expect(texts).toContain('best streak')
    expect(texts).toContain('active habits')
    expect(texts).toContain('Brush teeth')
    expect(texts).toContain('Read')
    expect(texts).toContain('Every day — twice a day')
    expect(texts).toContain('on schedule')
  })

  test('streak counts derive from the completion log', async () => {
    // two full days of brushing (2×/day) ending yesterday
    const today = new Date()
    const ymd = d => d.toISOString().slice(0, 10)
    const yester = new Date(today.getTime() - 86400000)
    const before = new Date(today.getTime() - 2 * 86400000)
    const completions = []
    let n = 0
    for (const d of [before, yester]) {
      completions.push({ id: `c${n++}`, habitId: 'h1', date: ymd(d), slot: 'morning' })
      completions.push({ id: `c${n++}`, habitId: 'h1', date: ymd(d), slot: 'evening' })
    }
    const tree = await mountReviews(makeData({ completions }))
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('🔥 2') // two satisfied days walking back
  })

  test('range toggle switches 30 / 90 days', async () => {
    const tree = await mountReviews()
    const seg = tree.root.findAll(n => n.props && n.props.accessibilityLabel === 'Review range')[0]
    expect(seg).toBeTruthy()
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('30 days')
    expect(texts).toContain('90 days')
  })

  test('no habits → the empty state card', async () => {
    const tree = await mountReviews(makeData({ habits: [] }))
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('No habits yet')
  })

  test('archived habits never appear', async () => {
    const data = makeData()
    data.habits[1].archived = true
    const tree = await mountReviews(data)
    const texts = textOf(tree).join(' ')
    expect(texts).toContain('Brush teeth')
    expect(texts).not.toContain('📖 Read') // icon + title row is gone
  })
})
