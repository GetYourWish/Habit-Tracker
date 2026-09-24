// flow-chart.test.js — the v1.0.11 Flow State AREA chart (the desktop
// ChronoStream shape the user asked for: "the flow shows a bar chart instead
// of having the actual flow"). Pins:
//   - the monotone sampler (Fritsch–Carlson): endpoints exact, never
//     overshoots below 0 or above the neighbor scores, flat data stays flat
//   - buildFlowGeometry: future days leave their slots EMPTY (desktop
//     connectNulls=false), the last real day closes the area, long ranges
//     bucket to ≤120 points keeping each bucket's PEAK day, dots only on
//     days with completions
//   - FlowStateArea rendering: tappable dots open the day, week view shows
//     weekday labels + score labels, empty range shows the empty state

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  monotoneTangents,
  hermiteSample,
  buildFlowGeometry,
  FlowStateArea,
  FLOW_MAX_POINTS
} from '../src/components/reviews/charts.js'
import { buildTheme } from '../src/theme.js'

const theme = buildTheme('dark', 'dark')

function day(offset, score, count, isFuture = false) {
  return {
    date: `2026-09-${String(10 + offset).padStart(2, '0')}`,
    day: new Date(2026, 8, 10 + offset),
    dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][offset % 7],
    fullDate: `Sep ${10 + offset}`,
    score,
    count,
    isFuture
  }
}

describe('monotone sampler (recharts type="monotone" family)', () => {
  test('endpoints are exact: t=0 → y0, t=1 → y1', () => {
    const m = monotoneTangents([0.2, 0.8])
    expect(hermiteSample(0.2, 0.8, m[0], m[1], 0)).toBeCloseTo(0.2, 9)
    expect(hermiteSample(0.2, 0.8, m[0], m[1], 1)).toBeCloseTo(0.8, 9)
  })

  test('flat data produces a flat line (zero tangents)', () => {
    expect(monotoneTangents([1, 1, 1])).toEqual([0, 0, 0])
    const m = monotoneTangents([0.5, 0.5, 0.5, 0.5])
    for (let i = 0; i < 3; i++) {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        expect(hermiteSample(0.5, 0.5, m[i], m[i + 1], t)).toBeCloseTo(0.5, 9)
      }
    }
  })

  test('never overshoots: samples stay within [min, max] of the neighbors', () => {
    const ys = [0, 1, 0.2, 0.9, 0.1, 0.7, 0]
    const m = monotoneTangents(ys)
    for (let i = 0; i < ys.length - 1; i++) {
      const lo = Math.min(ys[i], ys[i + 1])
      const hi = Math.max(ys[i], ys[i + 1])
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = hermiteSample(ys[i], ys[i + 1], m[i], m[i + 1], t)
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(v).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })

  test('score-shaped data never dips below zero', () => {
    const ys = [0, 0.4, 0, 0.7, 0, 0.2, 0]
    const m = monotoneTangents(ys)
    for (let i = 0; i < ys.length - 1; i++) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(hermiteSample(ys[i], ys[i + 1], m[i], m[i + 1], t)).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })
})

describe('buildFlowGeometry (desktop ChronoStream data shape)', () => {
  test('future days leave their slots empty (connectNulls=false)', () => {
    // 7-day week, 5 real days + 2 future days
    const series = [
      day(0, 1, 1),
      day(1, 2, 2),
      day(2, 0, 0),
      day(3, 1.5, 1),
      day(4, 0.5, 1),
      day(5, null, 0, true),
      day(6, null, 0, true)
    ]
    const geo = buildFlowGeometry(series)
    expect(geo.points).toHaveLength(7)
    const k = geo.k
    expect(geo.totalSlots).toBe(6 * k)
    // the future stretches (pair 4→5 and 5→6) stay empty — EXCEPT slot 4k,
    // the boundary column where the area reaches day 4's own height
    for (let s = 1; s < k; s++) {
      expect(geo.samples[4 * k + s]).toBeNull()
      expect(geo.samples[5 * k + s]).toBeNull()
    }
    for (let s = 0; s < k; s++) {
      expect(geo.samples[5 * k + s]).toBeNull()
    }
    // day 4's boundary column is its exact height (0.5 score / max 2)
    expect(geo.samples[4 * k]).toBeCloseTo(0.5 / 2, 9)
    // dots: only the days with completions
    expect(geo.dots.map(d => d.date)).toEqual([
      series[0].date,
      series[1].date,
      series[3].date,
      series[4].date
    ])
  })

  test('the peak day normalizes to height 1', () => {
    const series = [day(0, 3, 2), day(1, 1, 1), day(2, 3, 3), day(3, 0, 0)]
    const geo = buildFlowGeometry(series)
    expect(geo.max).toBe(3)
    expect(geo.samples[0]).toBeCloseTo(1, 9)
    // monotone rise 0→1 must pass through intermediate values, not jump
    const rising = geo.samples.slice(0, geo.k)
    expect(rising[0]).toBeCloseTo(1, 9)
    expect(rising[geo.k - 1]).toBeGreaterThan(0.3)
    expect(rising[geo.k - 1]).toBeLessThan(1)
  })

  test('long ranges bucket to ≤ FLOW_MAX_POINTS days, keeping each bucket peak', () => {
    const series = []
    for (let i = 0; i < 200; i++) {
      // scores: 1 for most days, but day 100 (in some bucket) scores 5
      series.push(day(i, i === 100 ? 5 : 1, i === 100 ? 4 : 1))
    }
    const geo = buildFlowGeometry(series)
    expect(geo.points.length).toBeLessThanOrEqual(FLOW_MAX_POINTS)
    expect(geo.max).toBe(5)
    // the peak day survived bucketing as a dot (it had completions)
    const peakDot = geo.dots.find(d => d.score === 5)
    expect(peakDot).toBeTruthy()
    expect(peakDot.count).toBe(4)
  })

  test('all-zero range still lays out the baseline (max floors at 1)', () => {
    const series = [day(0, 0, 0), day(1, 0, 0), day(2, 0, 0)]
    const geo = buildFlowGeometry(series)
    expect(geo.max).toBe(1)
    expect(geo.dots).toHaveLength(0)
    expect(geo.samples.every(s => s === 0)).toBe(true)
  })
})

describe('FlowStateArea component (desktop ChronoStream view)', () => {
  const weekSeries = [
    day(0, 1, 1),
    day(1, 2.4, 2),
    day(2, 0, 0),
    day(3, 1.5, 1),
    day(4, 0.5, 1),
    day(5, null, 0, true),
    day(6, null, 0, true)
  ]

  function mount(series = weekSeries, onDayPress = jest.fn()) {
    let tree = null
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <FlowStateArea theme={theme} series={series} flowStateColor="#8b5cf6" onDayPress={onDayPress} />
      )
    })
    return { tree, onDayPress }
  }

  function textOf(node) {
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

  test('renders a tappable dot per day with completions; tap opens the day', async () => {
    const { tree, onDayPress } = mount()
    const dot = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string' && n.props.onPress)
      .find(n => n.props.accessibilityLabel.startsWith('Sep 11:'))
    expect(dot).toBeTruthy() // day(1): 2.4 points, 2 tasks
    expect(dot.props.accessibilityLabel).toContain('2.4 points, 2 tasks')
    await act(async () => {
      dot.props.onPress()
    })
    expect(onDayPress).toHaveBeenCalledWith(weekSeries[1].date)
  })

  test('week view labels every weekday and shows score labels above dots', () => {
    const { tree } = mount()
    const texts = textOf(tree.toJSON()).join(' ')
    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(texts).toContain(label)
    }
    // score labels (week view only): 1, 2.4, 1.5, 0.5 render near the dots
    for (const score of ['2.4', '1.5']) {
      expect(texts).toContain(score)
    }
    expect(texts).toContain('Tap a dot to open that day')
  })

  test('empty range renders the empty state, not a chart', () => {
    let tree = null
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <FlowStateArea theme={theme} series={[day(0, 0, 0), day(1, 0, 0)]} flowStateColor="#8b5cf6" />
      )
    })
    const texts = textOf(tree.toJSON()).join(' ')
    expect(texts).toContain('No completions in this range yet')
  })

  test('month-scale series thins x labels to short dates', () => {
    const monthSeries = []
    for (let i = 0; i < 28; i++) monthSeries.push(day(i, i % 3 === 0 ? 1 : 0, i % 3 === 0 ? 1 : 0))
    let tree = null
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <FlowStateArea theme={theme} series={monthSeries} flowStateColor="#8b5cf6" />
      )
    })
    const texts = textOf(tree.toJSON())
    // 28 days thinned: at most 8 label slots actually carry text
    const dateLabels = texts.filter(t => t.startsWith('Sep '))
    expect(dateLabels.length).toBeGreaterThan(0)
    expect(dateLabels.length).toBeLessThanOrEqual(8)
  })
})
