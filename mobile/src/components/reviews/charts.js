// reviews/charts.js — the Reviews screen's data plumbing and View-based
// charts. Everything here is a faithful port of the DESKTOP
// Reviews.jsx / ChronoStream.jsx / StackedChart.jsx / HeatmapSkyline.jsx
// logic with two deliberate differences:
//   1. NO chart library — bars, stacks and the heatmap grid are plain RN
//      Views (flex widths/heights), so the app gains no native dependency.
//   2. Day scores come from core calculateDayScore (the desktop's inline
//      duplicates compute the same numbers — verified by the shared
//      golden-fixture contract).
//
// Every number a user sees must match the desktop exactly: same fatigue
// order, same category multipliers, same grouping (core groupTasksByDate
// sorts each day by completedAt — same as the desktop's pre-grouped map).

import React from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import {
  calculateDayScore,
  calculateTaskScoreBreakdown,
  formatDate,
  parseDate,
  getStartOfWeek
} from '@habit-tracker/core'
import {
  addDays,
  subDays,
  startOfDay,
  eachDayOfInterval,
  startOfMonth,
  startOfYear,
  formatWeekday,
  formatShortDate
} from '../../dates.js'
import { SPACING, TYPE } from '../../theme.js'
import { withAlpha } from '../rows.js'

// --- score cache (desktop Dashboard.buildScoreCache, verbatim semantics) ---

export function buildScoreCache(completedTasks, difficulties, categories, fatigueInc, fatigueCap) {
  const cache = new Map()
  for (const task of completedTasks) {
    cache.set(
      task.id,
      calculateTaskScoreBreakdown(task, completedTasks, difficulties, fatigueInc, fatigueCap, categories)
    )
  }
  return cache
}

// --- range filtering (desktop Dashboard.filterByRange) ----------------------

// NOTE: Segmented reads opt.value — the option objects MUST carry `value`
// (a `key`-shaped list makes every tap onChange(undefined)).
export const RANGE_OPTIONS = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' }
]

export function filterByRange(tasks, rangeKey, now = new Date()) {
  if (rangeKey === 'all') return tasks
  let start = null
  if (rangeKey === '30d') start = subDays(now, 29)
  else if (rangeKey === '90d') start = subDays(now, 89)
  else if (rangeKey === 'year') start = startOfYear(now.getFullYear())
  if (!start) return tasks
  return tasks.filter(t => {
    if (!t.completion || !t.completion.completedAt) return false
    return new Date(t.completion.completedAt) >= start
  })
}

// --- per-day series (desktop ChronoStream/StackedChart data derivation) ----

// One entry per calendar day in [start, end]:
//   { date, day, dayName, fullDate, score, count, isFuture }
// Future days (week/month views) carry score:null — the desktop renders
// them as empty chart area; we render them as flat, dimmed slots.
export function buildDaySeries({ start, end, tasksByDate, difficulties, categories, settings }) {
  const days = eachDayOfInterval({ start, end })
  const today = startOfDay(new Date())
  return days.map(day => {
    const dateStr = formatDate(day)
    const daysTasks = tasksByDate.get(dateStr) || []
    const isFuture = startOfDay(day) > today
    if (isFuture) {
      return {
        date: dateStr,
        day,
        dayName: formatWeekday(day),
        fullDate: formatShortDate(day),
        score: null,
        count: 0,
        isFuture: true
      }
    }
    const score = calculateDayScore(
      daysTasks,
      difficulties,
      settings.fatigueIncrement || 0.10,
      settings.fatigueCap || 3.0,
      categories
    )
    return {
      date: dateStr,
      day,
      dayName: formatWeekday(day),
      fullDate: formatShortDate(day),
      score,
      count: daysTasks.length,
      isFuture: false
    }
  })
}

// Range windows for the Flow State / Stacked tabs (desktop ChronoStream
// dateRange: 'week' = current week, 'month' = current month, 'all' = first
// logged day .. last logged day).
export function resolveChartRange(range, completedTasks, weekStartsOn) {
  const today = startOfDay(new Date())
  if (range === 'week') {
    // core getStartOfWeek(date, weekStartsOn) takes the NUMBER directly
    // (date-fns's { weekStartsOn } options-object convention is desktop-only).
    const start = getStartOfWeek(today, weekStartsOn || 1)
    const end = addDays(start, 6)
    return { start, end }
  }
  if (range === 'month') {
    const start = startOfMonth(today)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return { start, end }
  }
  const dates = completedTasks
    .map(t => (t.completion ? t.completion.completedDate : null))
    .filter(Boolean)
    .sort()
  if (dates.length === 0) return { start: today, end: today }
  return { start: parseDate(dates[0]), end: parseDate(dates[dates.length - 1]) }
}

// --- shared chart chrome ------------------------------------------------------

function ChartEmpty({ theme, label }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
      <Text style={{ color: theme.textMuted, ...TYPE.secondary }}>{label}</Text>
    </View>
  )
}

// --- Flow State area (desktop ChronoStream — recharts monotone AreaChart) --
// The v1.0.10 port rendered plain BARS ("the flow shows a bar chart instead
// of having the actual flow"); this is the actual desktop shape: a smooth
// monotone AREA of the daily score in the user's flow-state color (fill at
// desktop's 0.4 opacity + a solid top edge), broken at future days exactly
// like recharts connectNulls={false}, with a tappable dot on every day that
// has completions (the desktop's clickable r=6 dots). No chart library —
// the curve is subdivided into contiguous micro-columns of plain Views.
//
// Interpolation: Fritsch–Carlson monotone cubic — the same family recharts'
// type="monotone" uses. It cannot overshoot: every sample stays between the
// two neighboring day scores (and therefore never dips below 0).

// Tangents for monotone cubic Hermite interpolation (uniform spacing).
export function monotoneTangents(ys) {
  const n = ys.length
  if (n === 0) return []
  if (n === 1) return [0]
  const d = []
  for (let i = 0; i < n - 1; i++) d.push(ys[i + 1] - ys[i])
  const m = [d[0]]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0)
    } else {
      // weighted harmonic mean of the neighboring slopes (Fritsch–Carlson)
      m.push((3 * (d[i - 1] + d[i])) / (1 / d[i - 1] + 1 / d[i] + 2))
    }
  }
  m.push(d[n - 2])
  // clamp so no tangent exceeds 3x the local slope (monotonicity guarantee)
  for (let i = 0; i < n; i++) {
    const dLeft = i > 0 ? d[i - 1] : d[0]
    const dRight = i < n - 1 ? d[i] : d[n - 2]
    const bound = 3 * Math.min(Math.abs(dLeft), Math.abs(dRight))
    if (Math.abs(m[i]) > bound) m[i] = Math.sign(m[i]) * bound
  }
  return m
}

// One monotone-cubic sample on the segment [y0, y1].
export function hermiteSample(y0, y1, m0, m1, t) {
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * m1
  )
}

// Chart geometry, pure + exported for tests:
//  - long ranges ('all') are bucketed to ≤ MAX_POINTS days (each bucket
//    keeps its PEAK day — score and date — so the dot opens the best day)
//  - every consecutive point pair subdivides into `k` micro-samples; pairs
//    touching a future/null point leave those slots EMPTY (connectNulls=false)
//  - heights are normalized 0..1 against the max day score (min 1)
export const FLOW_MAX_POINTS = 120

export function buildFlowGeometry(series, maxPoints = FLOW_MAX_POINTS) {
  const clean = (series || []).filter(Boolean)
  const bucketSize = Math.max(1, Math.ceil(clean.length / maxPoints))
  const points = []
  if (bucketSize === 1) {
    for (const d of clean) points.push(d)
  } else {
    for (let i = 0; i < clean.length; i += bucketSize) {
      const bucket = clean.slice(i, i + bucketSize)
      let peak = null
      for (const d of bucket) {
        if (d.isFuture || d.score == null) continue
        if (!peak || d.score > peak.score) peak = d
      }
      points.push(peak || { ...bucket[bucket.length - 1], score: 0 })
    }
  }

  const isReal = p => p && !p.isFuture && p.score != null
  const real = points.filter(isReal)
  const max = Math.max(1, ...real.map(p => p.score || 0))
  const n = points.length
  const k = Math.max(1, Math.min(12, Math.floor(96 / Math.max(1, n))))
  const totalSlots = Math.max(1, (n - 1) * k)

  const samples = new Array(totalSlots).fill(null)
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!isReal(a) || !isReal(b)) continue // gap (future/null) — stays empty
    const ya = (a.score || 0) / max
    const yb = (b.score || 0) / max
    if (k === 1) {
      samples[i] = ya
      continue
    }
    // tangents recomputed per PAIR keeps segments independent and gap-safe
    const m = monotoneTangents([ya, yb])
    for (let s = 0; s < k; s++) {
      samples[i * k + s] = Math.max(0, hermiteSample(ya, yb, m[0], m[1], s / k))
    }
  }
  // boundary columns: a real day directly before a gap still gets its own
  // column at its exact height — the area must REACH that day, then stop
  for (let i = 0; i < n - 1; i++) {
    if (isReal(points[i]) && samples[i * k] == null) {
      samples[i * k] = (points[i].score || 0) / max
    }
  }
  if (n > 0 && isReal(points[n - 1]) && totalSlots > 0) {
    samples[totalSlots - 1] = (points[n - 1].score || 0) / max
  }

  // dots: one per real day (bucket peak) with completions, x in 0..1
  const dots = []
  points.forEach((p, i) => {
    if (!isReal(p) || !p.count || p.count === 0) return
    dots.push({ date: p.date, fullDate: p.fullDate, score: p.score, count: p.count, x: n > 1 ? i / (n - 1) : 0.5 })
  })

  return { points, samples, dots, max, k, totalSlots }
}

export function FlowStateArea({ theme, series, flowStateColor, onDayPress, height = 150 }) {
  const geo = buildFlowGeometry(series)
  if (geo.dots.length === 0 && geo.samples.every(s => s == null || s === 0)) {
    return <ChartEmpty theme={theme} label="No completions in this range yet" />
  }

  const n = geo.points.length
  const isWeek = n <= 8 // weekday labels only when every day has room
  // sparse labels: ≤ 8 on the axis, always including the last point
  const step = Math.max(1, Math.ceil(n / 8))

  return (
    <View>
      {/* the chart: micro-columns (fill + solid top edge) + tappable dots */}
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end' }}>
        {geo.samples.map((v, i) =>
          v == null ? (
            <View key={i} style={{ flex: 1, height: 0 }} />
          ) : (
            <View
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(v * 100, v > 0 ? 1.5 : 0)}%`,
                backgroundColor: withAlpha(flowStateColor, '66'), // desktop fillOpacity 0.4
                overflow: 'hidden',
                alignItems: 'stretch'
              }}
            >
              {/* solid top edge — reads as the curve's stroke line */}
              <View style={{ height: 2, backgroundColor: flowStateColor }} />
            </View>
          )
        )}
        {geo.dots.map(d => {
          const yFrac = Math.min(1, (d.score || 0) / geo.max)
          return (
            <Pressable
              key={d.date}
              onPress={() => onDayPress && onDayPress(d.date)}
              style={{
                position: 'absolute',
                left: `${d.x * 100}%`,
                bottom: `${yFrac * 100}%`,
                width: 34,
                height: 34,
                marginLeft: -17,
                marginBottom: -17,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10
              }}
              accessibilityLabel={`${d.fullDate}: ${Math.round(d.score * 10) / 10} points, ${d.count} ${d.count === 1 ? 'task' : 'tasks'}`}
              accessibilityRole="button"
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: flowStateColor
                }}
              />
              {isWeek ? (
                <Text
                  style={{
                    position: 'absolute',
                    bottom: 34,
                    color: theme.textSecondary,
                    fontSize: 9.5,
                    fontWeight: '600'
                  }}
                >
                  {String(Math.round(d.score * 10) / 10)}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      {/* x labels: weekday (week view) or short date, thinned to fit */}
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {geo.points.map((p, i) => {
          const show = i % step === 0 || i === n - 1
          return (
            <View key={p.date} style={{ flex: 1, alignItems: 'center' }}>
              {show ? (
                <Text style={{ color: theme.textMuted, fontSize: 9.5 }} numberOfLines={1}>
                  {isWeek ? p.dayName : p.fullDate}
                </Text>
              ) : null}
            </View>
          )
        })}
      </View>
      <Text style={{ color: theme.textMuted, marginTop: SPACING.sm, ...TYPE.caption, textAlign: 'center' }}>
        Tap a dot to open that day
      </Text>
    </View>
  )
}

// --- Stacked category bars (desktop StackedChart → mobile stacked columns) --

// Per day: a column of colored segments — one per category, height
// proportional to the category's points that day (uncategorized gray).
export function StackedCategoryBars({ theme, series, tasksByDate, categories, scoreCache, onDayPress }) {
  const real = series.filter(d => !d.isFuture && d.count > 0)
  if (real.length === 0) return <ChartEmpty theme={theme} label="No completions in this range yet" />

  const catMap = new Map(categories.map(c => [c.id, c]))
  const UNCATEGORIZED = { id: '__none__', name: 'Uncategorized', color: '#9ca3af' }

  const rows = real.map(d => {
    const dayTasks = tasksByDate.get(d.date) || []
    const byCat = new Map()
    for (const t of dayTasks) {
      const cat = t.completion.categoryId ? catMap.get(t.completion.categoryId) : null
      const key = cat ? cat.id : UNCATEGORIZED.id
      const bd = scoreCache.get(t.id)
      const pts = bd ? bd.finalScore : 0
      byCat.set(key, (byCat.get(key) || 0) + pts)
    }
    return { day: d, segments: [...byCat.entries()] }
  })

  const maxDay = Math.max(
    ...rows.map(r => r.segments.reduce((s, [, pts]) => s + pts, 0)),
    1
  )

  const legendIds = new Set()
  rows.forEach(r => r.segments.forEach(([id]) => legendIds.add(id)))
  const legend = [...legendIds].map(id => {
    if (id === UNCATEGORIZED.id) return UNCATEGORIZED
    const c = catMap.get(id)
    return c || UNCATEGORIZED
  })

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        {rows.map(({ day, segments }) => {
          const total = segments.reduce((s, [, pts]) => s + pts, 0)
          return (
            <Pressable
              key={day.date}
              onPress={() => onDayPress && onDayPress(day.date)}
              style={{ flex: 1, alignItems: 'center', gap: 4 }}
              accessibilityLabel={`${day.fullDate}: ${Math.round(total * 10) / 10} points`}
              accessibilityRole="button"
            >
              <View
                style={{
                  width: '82%',
                  maxWidth: 36,
                  minHeight: 6,
                  height: Math.max(6, Math.round((total / maxDay) * 130)),
                  borderRadius: 5,
                  overflow: 'hidden',
                  flexDirection: 'column-reverse'
                }}
              >
                {segments.map(([id, pts]) => {
                  const cat = id === UNCATEGORIZED.id ? UNCATEGORIZED : catMap.get(id) || UNCATEGORIZED
                  return (
                    <View
                      key={id}
                      style={{
                        height: `${(pts / total) * 100}%`,
                        backgroundColor: cat.color
                      }}
                    />
                  )
                })}
              </View>
              <Text style={{ color: theme.textSecondary, fontSize: 10 }}>{day.dayName}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 9 }}>{day.fullDate}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginTop: SPACING.md }}>
        {legend.map(c => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} />
            <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{c.name}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// --- Heatmap (desktop HeatmapSkyline/HeatmapGrid → mobile scrollable grid) --

// GitHub-style year grid: 7 weekday rows × N week columns, horizontally
// scrollable, month labels on top. Cell intensity follows the desktop's
// getColorIntensity quartiles; value = score or count per
// settings.heatmapMode. Tap a cell → that day.
export function HeatmapColor(value, maxValue) {
  if (value === 0) return null // caller renders the empty tint
  const ratio = Math.min(value / maxValue, 1)
  if (ratio > 0.75) return '#22c55e'
  if (ratio > 0.5) return '#4ade80'
  if (ratio > 0.25) return '#86efac'
  return '#bbf7d0'
}

export function buildHeatmapYear({ year, tasksByDate, difficulties, categories, settings }) {
  const start = startOfYear(year)
  const end = new Date(year, 11, 31)
  const days = eachDayOfInterval({ start, end })
  return days.map(day => {
    const dateStr = formatDate(day)
    const daysTasks = tasksByDate.get(dateStr) || []
    let value
    if (settings.heatmapMode === 'count') {
      value = daysTasks.length
    } else {
      value = calculateDayScore(
        daysTasks,
        difficulties,
        settings.fatigueIncrement || 0.10,
        settings.fatigueCap || 3.0,
        categories
      )
    }
    return { date: dateStr, day, value }
  })
}

export function HeatmapGrid({ theme, cells, onDayPress }) {
  if (cells.length === 0) return <ChartEmpty theme={theme} label="No data for this year" />
  const max = Math.max(...cells.map(c => c.value), 1)

  // Column layout: weeks start Sunday (the desktop grid simply flows days
  // left→right, top→bottom in weekday rows — the first column is padded so
  // Jan 1 lands on its weekday row).
  const firstDay = cells[0].day
  const leadPadding = firstDay.getDay()
  const columns = []
  let current = []
  for (let i = 0; i < leadPadding; i++) current.push(null)
  for (const cell of cells) {
    current.push(cell)
    if (cell.day.getDay() === 6) {
      columns.push(current)
      current = []
    }
  }
  if (current.length > 0) columns.push(current)

  // Month label per column: the month of the column's first REAL cell,
  // printed only when it changes (desktop prints Jan Feb Mar … over the
  // columns where months start).
  const monthLabels = columns.map((col, i) => {
    const first = col.find(Boolean)
    if (!first) return ''
    const m = first.day.getMonth()
    const prev = i > 0 ? columns[i - 1].find(Boolean) : null
    const prevM = prev ? prev.day.getMonth() : -1
    return m !== prevM ? formatShortDate(first.day).split(' ')[0] : ''
  })

  const CELL = 13
  const GAP = 3

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.xs }}>
        <View>
          <View style={{ flexDirection: 'row', gap: GAP, marginBottom: 4, height: 14 }}>
            {monthLabels.map((label, i) => (
              <Text key={i} style={{ color: theme.textMuted, fontSize: 9.5, width: CELL, textAlign: 'center' }} numberOfLines={1}>
                {label}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {columns.map((col, ci) => (
              <View key={ci} style={{ gap: GAP }}>
                {col.map((cell, ri) => {
                  if (!cell) return <View key={ri} style={{ width: CELL, height: CELL }} />
                  const color = HeatmapColor(cell.value, max)
                  return (
                    <Pressable
                      key={cell.date}
                      onPress={() => cell.value > 0 && onDayPress && onDayPress(cell.date)}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 3,
                        backgroundColor: color || theme.bgTertiary
                      }}
                      accessibilityLabel={`${cell.date}: ${cell.value === 0 ? 'no completions' : `${Math.round(cell.value * 10) / 10}`}`}
                      accessibilityRole="button"
                    />
                  )
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.md, justifyContent: 'center' }}>
        <Text style={{ color: theme.textMuted, fontSize: 10 }}>Less</Text>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: theme.bgTertiary }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#bbf7d0' }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#86efac' }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#4ade80' }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#22c55e' }} />
        <Text style={{ color: theme.textMuted, fontSize: 10 }}>More</Text>
      </View>
    </View>
  )
}
