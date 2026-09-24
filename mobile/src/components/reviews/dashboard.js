// reviews/dashboard.js — the Performance Cockpit, ported from the desktop
// Dashboard.jsx. Same four panels (INTENSITY / RECORDS / RHYTHM /
// COMPOSITION), same card ids (settings.dashboard.<id> visibility toggles
// are shared with the desktop through habit.json), same computations —
// each block below carries the desktop formula in comments. Visualizations
// are plain RN Views: gauges become marker bars, recharts bars become View
// bars, the donut becomes a proportional stacked bar. All numbers must
// match the desktop EXACTLY (they come from the same core functions and
// the same orderings).

import React, { useMemo, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import {
  calculateDayScore,
  groupTasksByDate,
  formatDate,
  parseDate,
  getStartOfWeek
} from '@habit-tracker/core'
import {
  subDays,
  startOfDay,
  differenceInDays,
  formatShortDate,
  formatMediumDate,
  formatMonthYear
} from '../../dates.js'
import { GlassCard, Segmented } from '../ui.js'
import { SPACING, TYPE } from '../../theme.js'
import { buildScoreCache, filterByRange, RANGE_OPTIONS } from './charts.js'

const PANEL_TITLES = {
  intensity: 'INTENSITY',
  records: 'RECORDS',
  rhythm: 'RHYTHM',
  composition: 'COMPOSITION'
}

function isCardVisible(settings, cardId) {
  const dash = settings.dashboard || {}
  return dash[cardId] !== false
}

// --- small shared display pieces ---------------------------------------------

function StatTile({ theme, value, label }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.rowFill, borderRadius: 12, padding: SPACING.md }}>
      <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, marginTop: 2, ...TYPE.caption }}>{label}</Text>
    </View>
  )
}

function CardLabel({ theme, children }) {
  return (
    <Text style={{ color: theme.textSecondary, ...TYPE.sectionTitle, marginBottom: SPACING.sm }}>
      {children}
    </Text>
  )
}

function Card({ theme, children }) {
  return (
    <View style={{ backgroundColor: theme.rowFill, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.md }}>
      {children}
    </View>
  )
}

function EmptyPanel({ theme }) {
  return (
    <Text style={{ color: theme.textMuted, ...TYPE.secondary, textAlign: 'center', paddingVertical: SPACING.lg }}>
      Complete tasks to unlock this panel.
    </Text>
  )
}

function MiniBars({ theme, data, color, formatValue }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 84 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
          <View
            style={{
              width: '80%',
              maxWidth: 26,
              height: Math.max(3, Math.round((d.value / max) * 56)),
              minHeight: 3,
              borderRadius: 4,
              backgroundColor: d.highlight ? '#22c55e' : color
            }}
          />
          <Text style={{ color: theme.textMuted, fontSize: 9 }} numberOfLines={1}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

// --- INTENSITY (desktop IntensityPanel) ---------------------------------------

function IntensityPanel({ theme, rangeTasks, difficulties, categories, settings, scoreCache }) {
  if (rangeTasks.length === 0) return <EmptyPanel theme={theme} />

  const diffMap = new Map(difficulties.map(d => [d.id, d]))
  const sortedDiffs = [...difficulties].filter(d => d.active !== false).sort((a, b) => a.score - b.score)
  const minDiff = sortedDiffs.length > 0 ? sortedDiffs[0].score : 0
  const maxDiff = sortedDiffs.length > 0 ? sortedDiffs[sortedDiffs.length - 1].score : 1
  const range = maxDiff - minDiff || 1

  // avgDifficulty: mean difficulty score over the range's completions
  const avgDifficulty = rangeTasks.reduce((sum, t) => {
    const d = diffMap.get(t.completion ? t.completion.difficultyId : null)
    return sum + (d ? d.score : 0)
  }, 0) / rangeTasks.length
  const avgPosition = Math.max(0, Math.min(100, ((avgDifficulty - minDiff) / range) * 100))

  // true vs effort: finalScore vs basePoints*fatigueMultiplier (no priority)
  let totalTrue = 0
  let totalEffort = 0
  rangeTasks.forEach(t => {
    const bd = scoreCache.get(t.id)
    if (bd) {
      totalTrue += bd.finalScore
      totalEffort += bd.basePoints * bd.fatigueMultiplier
    }
  })
  const pointsPerTask = rangeTasks.length > 0 ? totalTrue / rangeTasks.length : 0
  const delta = totalEffort > 0 ? ((totalTrue - totalEffort) / totalEffort) * 100 : 0

  // intensity trend: average difficulty per week (last 12 weeks with data)
  const weekMap = new Map()
  rangeTasks.forEach(t => {
    if (!t.completion || !t.completion.completedAt) return
    const d = new Date(t.completion.completedAt)
    // core getStartOfWeek(date, weekStartsOn) takes the NUMBER directly
    const weekStart = getStartOfWeek(d, settings.weekStartsOn || 1)
    const key = formatDate(weekStart)
    if (!weekMap.has(key)) weekMap.set(key, { sum: 0, count: 0 })
    const entry = weekMap.get(key)
    const diff = diffMap.get(t.completion.difficultyId)
    entry.sum += diff ? diff.score : 0
    entry.count++
  })
  const trendData = [...weekMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([key, v]) => ({
      label: formatShortDate(parseDate(key)),
      value: v.count > 0 ? v.sum / v.count : 0
    }))

  return (
    <>
      {isCardVisible(settings, 'avgDifficulty') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>AVG DIFFICULTY</CardLabel>
          <View
            style={{
              height: 10,
              borderRadius: 5,
              overflow: 'hidden',
              flexDirection: 'row',
              backgroundColor: theme.bgTertiary
            }}
          >
            {sortedDiffs.map(d => (
              <View
                key={d.id}
                style={{
                  flex: Math.max(d.score - minDiff, 0.001),
                  backgroundColor: d.color
                }}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: theme.textMuted, ...TYPE.caption }}>{minDiff}</Text>
            <Text style={{ color: theme.textPrimary, fontWeight: '800', fontSize: 15 }}>
              {avgDifficulty.toFixed(2)}
            </Text>
            <Text style={{ color: theme.textMuted, ...TYPE.caption }}>{maxDiff}</Text>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'pointsPerTask') && (
        <Card theme={theme}>
          <StatTile theme={theme} value={pointsPerTask.toFixed(1)} label="Points Per Task" />
        </Card>
      )}

      {isCardVisible(settings, 'intensityTrend') && trendData.length > 1 && (
        <Card theme={theme}>
          <CardLabel theme={theme}>INTENSITY TREND (WEEKLY AVG DIFFICULTY)</CardLabel>
          <MiniBars theme={theme} data={trendData.map(t => ({ label: t.label, value: t.value }))} color="#f87171" />
        </Card>
      )}

      {isCardVisible(settings, 'trueVsEffort') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>TRUE VS EFFORT</CardLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textPrimary, fontSize: 20, fontWeight: '800' }}>
                {totalTrue.toFixed(1)}
              </Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>true score</Text>
            </View>
            <Text style={{ color: theme.textMuted, ...TYPE.secondary }}>vs</Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: theme.textSecondary, fontSize: 20, fontWeight: '800' }}>
                {totalEffort.toFixed(1)}
              </Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>effort score</Text>
            </View>
          </View>
          <Text
            style={{
              color: delta >= 0 ? '#22c55e' : '#ef4444',
              marginTop: SPACING.sm,
              ...TYPE.secondary,
              fontWeight: '600'
            }}
          >
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)}% {delta >= 0 ? 'from working on what matters' : 'category drag'}
          </Text>
        </Card>
      )}
    </>
  )
}

// --- RECORDS (desktop RecordsPanel) -------------------------------------------

function RecordsPanel({ theme, allCompleted, rangeTasks, difficulties, categories, settings, scoreCache, onDayPress }) {
  if (allCompleted.length === 0) return <EmptyPanel theme={theme} />

  const catMap = new Map(categories.map(c => [c.id, c]))
  const tasksByDate = groupTasksByDate(allCompleted)

  // Per-day scores (desktop computes inline with the same fatigue order —
  // core calculateDayScore over each grouped day is the same math).
  const dateScores = new Map()
  for (const [dateStr, dayTasks] of tasksByDate) {
    dateScores.set(
      dateStr,
      {
        score: calculateDayScore(dayTasks, difficulties, settings.fatigueIncrement || 0.10, settings.fatigueCap || 3.0, categories),
        count: dayTasks.length
      }
    )
  }

  let bestDay = null
  const weekScores = new Map()
  const monthScores = new Map()
  for (const [dateStr, data] of dateScores) {
    if (!bestDay || data.score > bestDay.score) {
      bestDay = { date: dateStr, ...data }
    }
    const d = parseDate(dateStr)
    const ws = getStartOfWeek(d, settings.weekStartsOn || 1)
    const wKey = formatDate(ws)
    if (!weekScores.has(wKey)) weekScores.set(wKey, { score: 0, count: 0, label: formatShortDate(ws) })
    const w = weekScores.get(wKey)
    w.score += data.score
    w.count += data.count
    const mKey = `${d.getFullYear()}-${d.getMonth()}`
    if (!monthScores.has(mKey)) {
      monthScores.set(mKey, { score: 0, count: 0, label: formatMonthYear(d) })
    }
    const m = monthScores.get(mKey)
    m.score += data.score
    m.count += data.count
  }

  let bestWeek = { score: 0, label: '', count: 0 }
  for (const v of weekScores.values()) {
    if (v.score > bestWeek.score) bestWeek = v
  }
  let bestMonth = { score: 0, label: '', count: 0 }
  for (const v of monthScores.values()) {
    if (v.score > bestMonth.score) bestMonth = v
  }

  // Streaks (all time): current counts back from today/yesterday, longest
  // scans consecutive calendar days.
  const allDatesSet = new Set(dateScores.keys())
  const allDatesArr = [...allDatesSet].sort()
  let currentStreak = 0
  let longestStreak = 0
  let tempStreak = 0
  const now = new Date()
  const today = formatDate(now)
  const yesterday = formatDate(subDays(now, 1))

  if (allDatesSet.has(today) || allDatesSet.has(yesterday)) {
    let checkDate = allDatesSet.has(today) ? today : yesterday
    const idx = allDatesArr.indexOf(checkDate)
    for (let i = idx; i >= 0; i--) {
      const expected = formatDate(subDays(parseDate(checkDate), idx - i))
      if (allDatesSet.has(expected)) currentStreak++
      else break
    }
  }
  for (let i = 0; i < allDatesArr.length; i++) {
    if (i === 0) tempStreak = 1
    else {
      const prev = parseDate(allDatesArr[i - 1])
      const curr = parseDate(allDatesArr[i])
      if (differenceInDays(curr, prev) === 1) tempStreak++
      else tempStreak = 1
    }
    longestStreak = Math.max(longestStreak, tempStreak)
  }

  // Important streak: days containing a multiplier > 1 category completion
  const highPriorityIds = new Set(categories.filter(c => (c.priorityMultiplier ?? 1) > 1).map(c => c.id))
  const importantDatesArr = allDatesArr.filter(d => {
    const dayTasks = tasksByDate.get(d) || []
    return dayTasks.some(
      t => t.completion && t.completion.categoryId && highPriorityIds.has(t.completion.categoryId)
    )
  })
  const importantDatesSet = new Set(importantDatesArr)
  let importantCurrentStreak = 0
  let importantLongestStreak = 0
  let impTemp = 0
  if (importantDatesArr.length > 0) {
    if (importantDatesSet.has(today) || importantDatesSet.has(yesterday)) {
      const startD = importantDatesSet.has(today) ? today : yesterday
      const startIdx = importantDatesArr.indexOf(startD)
      for (let i = startIdx; i >= 0; i--) {
        const expected = formatDate(subDays(parseDate(startD), startIdx - i))
        if (importantDatesSet.has(expected)) importantCurrentStreak++
        else break
      }
    }
    for (let i = 0; i < importantDatesArr.length; i++) {
      if (i === 0) impTemp = 1
      else {
        const prev = parseDate(importantDatesArr[i - 1])
        const curr = parseDate(importantDatesArr[i])
        if (differenceInDays(curr, prev) === 1) impTemp++
        else impTemp = 1
      }
      importantLongestStreak = Math.max(importantLongestStreak, impTemp)
    }
  }

  // Heaviest lift: highest finalScore completion (all time)
  let heaviestLift = null
  let maxVal = 0
  allCompleted.forEach(t => {
    const bd = scoreCache.get(t.id)
    if (bd && bd.finalScore > maxVal) {
      maxVal = bd.finalScore
      heaviestLift = { task: t, breakdown: bd }
    }
  })

  // Balance days: days with completions in 2+ categories
  let balanceDays = 0
  for (const [, dayTasks] of tasksByDate) {
    const uniqueCats = new Set(
      dayTasks.map(t => (t.completion ? t.completion.categoryId : null)).filter(Boolean)
    )
    if (uniqueCats.size >= 2) balanceDays++
  }

  return (
    <>
      {isCardVisible(settings, 'bestPeriods') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>BEST PERIODS</CardLabel>
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {bestDay ? (
              <Pressable
                style={{ flex: 1, backgroundColor: theme.bgTertiary, borderRadius: 10, padding: SPACING.sm, alignItems: 'center' }}
                onPress={() => onDayPress && onDayPress(bestDay.date)}
                accessibilityRole="button"
                accessibilityLabel={`Best day ${formatMediumDate(parseDate(bestDay.date))}, ${bestDay.count} tasks`}
              >
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>Best Day</Text>
                <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '800' }}>
                  {bestDay.score.toFixed(1)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 9.5, textAlign: 'center' }}>
                  {formatMediumDate(parseDate(bestDay.date))} · {bestDay.count} tasks
                </Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1, backgroundColor: theme.bgTertiary, borderRadius: 10, padding: SPACING.sm, alignItems: 'center' }}>
              <Text style={{ color: theme.textMuted, fontSize: 10 }}>Best Week</Text>
              <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '800' }}>
                {bestWeek.score.toFixed(1)}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 9.5, textAlign: 'center' }}>
                {bestWeek.label || '-'} · {bestWeek.count} tasks
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.bgTertiary, borderRadius: 10, padding: SPACING.sm, alignItems: 'center' }}>
              <Text style={{ color: theme.textMuted, fontSize: 10 }}>Best Month</Text>
              <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '800' }}>
                {bestMonth.score.toFixed(1)}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 9.5, textAlign: 'center' }}>
                {bestMonth.label || '-'} · {bestMonth.count} tasks
              </Text>
            </View>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'streaks') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>STREAKS</CardLabel>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>{currentStreak}</Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>current</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>{longestStreak}</Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>longest</Text>
            </View>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'importantStreak') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>IMPORTANT STREAK (MULTIPLIER &gt; 1)</CardLabel>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>
                {importantCurrentStreak}
              </Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>current</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>
                {importantLongestStreak}
              </Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>longest</Text>
            </View>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'heaviestLift') && heaviestLift ? (
        <Card theme={theme}>
          <CardLabel theme={theme}>HEAVIEST LIFT</CardLabel>
          <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong }} numberOfLines={3}>
            {heaviestLift.task.text}
          </Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 6 }}>
            <View
              style={{
                backgroundColor: heaviestLift.breakdown.difficultyColor,
                borderRadius: 999,
                paddingHorizontal: SPACING.md,
                paddingVertical: 3
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '700' }}>
                {heaviestLift.breakdown.difficultyLabel}
              </Text>
            </View>
            {heaviestLift.breakdown.categoryName ? (
              <View
                style={{
                  backgroundColor: heaviestLift.breakdown.categoryColor,
                  borderRadius: 999,
                  paddingHorizontal: SPACING.md,
                  paddingVertical: 3
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '700' }}>
                  {heaviestLift.breakdown.categoryName}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.textPrimary, marginTop: 6, fontWeight: '800', fontSize: 16 }}>
            {heaviestLift.breakdown.finalScore} pts
          </Text>
          {heaviestLift.task.completion.note ? (
            <Text style={{ color: theme.textMuted, marginTop: 4, ...TYPE.caption }} numberOfLines={2}>
              "{heaviestLift.task.completion.note}"
            </Text>
          ) : null}
        </Card>
      ) : null}

      {isCardVisible(settings, 'balanceDays') && (
        <Card theme={theme}>
          <StatTile theme={theme} value={String(balanceDays)} label="Balance Days (2+ categories)" />
        </Card>
      )}
    </>
  )
}

// --- RHYTHM (desktop RhythmPanel) ---------------------------------------------

function RhythmPanel({ theme, allCompleted, rangeTasks, settings, scoreCache }) {
  if (allCompleted.length === 0) return <EmptyPanel theme={theme} />

  const now = new Date()
  const last30 = subDays(now, 29)
  const last30Tasks = allCompleted.filter(t => {
    if (!t.completion || !t.completion.completedDate) return false
    return parseDate(t.completion.completedDate) >= startOfDay(last30)
  })
  const uniqueDays30 = new Set(
    last30Tasks.map(t => (t.completion ? t.completion.completedDate : null)).filter(Boolean)
  )
  const activePct = Math.min(Math.round((uniqueDays30.size / 30) * 100), 100)

  const activeDaysInRange = new Set(
    rangeTasks.map(t => (t.completion ? t.completion.completedDate : null)).filter(Boolean)
  )
  const focusDepth = activeDaysInRange.size > 0 ? rangeTasks.length / activeDaysInRange.size : 0

  // Weekday strength: average score per ACTIVE weekday occurrence
  const weekdayData = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, i) => {
    const dayTasks = rangeTasks.filter(t => {
      if (!t.completion || !t.completion.completedAt) return false
      return new Date(t.completion.completedAt).getDay() === i
    })
    const uniqueDays = new Set(
      dayTasks.map(t => (t.completion ? t.completion.completedDate : null)).filter(Boolean)
    )
    const activeDayCount = uniqueDays.size
    let totalScore = 0
    dayTasks.forEach(t => {
      const bd = scoreCache.get(t.id)
      if (bd) totalScore += bd.finalScore
    })
    return { day: name, avg: activeDayCount > 0 ? totalScore / activeDayCount : 0, activeDays: activeDayCount }
  })
  const strongestDay = weekdayData.reduce((best, d) => (d.avg > best.avg ? d : best), weekdayData[0])

  // Shelf time: days between createdAt and completion; same-day rate
  const shelfTimes = []
  let sameDayCount = 0
  allCompleted.forEach(t => {
    if (!t.completion || !t.completion.completedAt || !t.createdAt) return
    const created = new Date(t.createdAt)
    const completed = new Date(t.completion.completedAt)
    shelfTimes.push(differenceInDays(completed, created))
    if (formatDate(created) === t.completion.completedDate) sameDayCount++
  })
  const avgShelf = shelfTimes.length > 0 ? shelfTimes.reduce((a, b) => a + b, 0) / shelfTimes.length : 0
  const sameDayRate = allCompleted.length > 0 ? Math.round((sameDayCount / allCompleted.length) * 100) : 0

  // Power hours: completion count per time block; golden window = best avg pts
  const blocks = [
    { label: 'Morning', minH: 5, maxH: 12 },
    { label: 'Afternoon', minH: 12, maxH: 17 },
    { label: 'Evening', minH: 17, maxH: 22 },
    { label: 'Night', minH: 22, maxH: 29 }
  ]
  const blockData = blocks.map(b => {
    const blockTasks = rangeTasks.filter(t => {
      if (!t.completion || !t.completion.completedAt) return false
      const h = new Date(t.completion.completedAt).getHours()
      return b.minH <= h && h < b.maxH
    })
    let totalPts = 0
    blockTasks.forEach(t => {
      const bd = scoreCache.get(t.id)
      if (bd) totalPts += bd.finalScore
    })
    return { block: b.label, count: blockTasks.length, avgPts: blockTasks.length > 0 ? totalPts / blockTasks.length : 0 }
  })
  const goldenWindow = blockData.reduce((best, b) => (b.avgPts > best.avgPts ? b : best), blockData[0])

  return (
    <>
      {isCardVisible(settings, 'activeDays') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>ACTIVE DAYS (LAST 30)</CardLabel>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: theme.textPrimary, fontSize: 30, fontWeight: '800' }}>{activePct}%</Text>
            <Text style={{ color: theme.textMuted, ...TYPE.caption }}>
              {uniqueDays30.size} of 30 days with a completion
            </Text>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'focusDepth') && (
        <Card theme={theme}>
          <StatTile theme={theme} value={focusDepth.toFixed(1)} label="Focus Depth (tasks / active day)" />
        </Card>
      )}

      {isCardVisible(settings, 'weekdayBars') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>WEEKDAY STRENGTH</CardLabel>
          <MiniBars
            theme={theme}
            data={weekdayData.map(d => ({
              label: d.day,
              value: d.avg,
              highlight: d.day === strongestDay.day
            }))}
            color="rgba(59,130,246,0.75)"
          />
          <Text style={{ color: theme.textMuted, marginTop: 6, ...TYPE.caption, textAlign: 'center' }}>
            Strongest: <Text style={{ color: theme.textSecondary, fontWeight: '700' }}>{strongestDay.day}</Text>
          </Text>
        </Card>
      )}

      {isCardVisible(settings, 'shelfTime') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>SHELF TIME</CardLabel>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>
                {avgShelf.toFixed(1)}
              </Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>avg days on board</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800' }}>{sameDayRate}%</Text>
              <Text style={{ color: theme.textMuted, ...TYPE.caption }}>same-day rate</Text>
            </View>
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'powerHours') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>POWER HOURS</CardLabel>
          <MiniBars
            theme={theme}
            data={blockData.map(b => ({ label: b.block.slice(0, 3), value: b.count }))}
            color="rgba(168,85,247,0.75)"
          />
          <Text style={{ color: theme.textMuted, marginTop: 6, ...TYPE.caption, textAlign: 'center' }}>
            Golden window: <Text style={{ color: theme.textSecondary, fontWeight: '700' }}>{goldenWindow.block}</Text>
          </Text>
        </Card>
      )}
    </>
  )
}

// --- COMPOSITION (desktop CompositionPanel) -----------------------------------

function CompositionPanel({ theme, rangeTasks, difficulties, categories, settings, scoreCache }) {
  const [donutMode, setDonutMode] = useState('tasks')

  if (rangeTasks.length === 0) return <EmptyPanel theme={theme} />

  const diffMap = new Map(difficulties.map(d => [d.id, d]))
  const catMap = new Map(categories.map(c => [c.id, c]))

  // Difficulty mix: share of completions per difficulty (sorted high→low)
  const sortedDiffs = [...difficulties].filter(d => d.active !== false).sort((a, b) => b.score - a.score)
  const diffCounts = new Map()
  rangeTasks.forEach(t => {
    const d = diffMap.get(t.completion ? t.completion.difficultyId : null)
    const label = d ? d.label : 'Unknown'
    diffCounts.set(label, (diffCounts.get(label) || 0) + 1)
  })
  const totalTasks = rangeTasks.length
  const mixData = sortedDiffs.map(d => {
    const count = diffCounts.get(d.label) || 0
    return { label: d.label, pct: totalTasks > 0 ? (count / totalTasks) * 100 : 0, color: d.color, count }
  })

  // Category breakdown (tasks | points), with an Uncategorized bucket
  const catByTasks = new Map()
  const catByPoints = new Map()
  let uncategorizedTasks = 0
  let uncategorizedPoints = 0
  rangeTasks.forEach(t => {
    const bd = scoreCache.get(t.id)
    if (!bd) return
    const cat = t.completion && t.completion.categoryId ? catMap.get(t.completion.categoryId) : null
    if (cat) {
      catByTasks.set(cat.id, (catByTasks.get(cat.id) || 0) + 1)
      catByPoints.set(cat.id, (catByPoints.get(cat.id) || 0) + bd.finalScore)
    } else {
      uncategorizedTasks++
      uncategorizedPoints += bd.finalScore
    }
  })
  const donutData = categories
    .filter(c => c.active !== false)
    .map(c => ({
      name: c.name,
      value: donutMode === 'tasks' ? catByTasks.get(c.id) || 0 : Math.round(catByPoints.get(c.id) || 0),
      color: c.color
    }))
    .filter(d => d.value > 0)
  if (uncategorizedTasks > 0 || uncategorizedPoints > 0) {
    donutData.push({
      name: 'Uncategorized',
      value: donutMode === 'tasks' ? uncategorizedTasks : Math.round(uncategorizedPoints),
      color: '#9ca3af'
    })
  }
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  // Top difficulty (highest score); alignment (points share in multiplier>1)
  const topDiff = sortedDiffs.length > 0 ? sortedDiffs[0] : null
  const topDiffCount = topDiff ? diffCounts.get(topDiff.label) || 0 : 0

  const highPriorityIds = new Set(categories.filter(c => (c.priorityMultiplier ?? 1) > 1).map(c => c.id))
  let highPriorityPoints = 0
  let totalPoints = 0
  rangeTasks.forEach(t => {
    const bd = scoreCache.get(t.id)
    if (!bd) return
    totalPoints += bd.finalScore
    if (t.completion && t.completion.categoryId && highPriorityIds.has(t.completion.categoryId)) {
      highPriorityPoints += bd.finalScore
    }
  })
  const alignmentPct = totalPoints > 0 ? Math.round((highPriorityPoints / totalPoints) * 100) : 0

  // Momentum: per active category, completions last 7d vs previous 7d
  const now = new Date()
  const last7 = subDays(now, 6)
  const prev7Start = subDays(now, 13)
  const momentumData = categories
    .filter(c => c.active !== false)
    .map(c => {
      const recent = rangeTasks.filter(t => {
        if (!t.completion || t.completion.categoryId !== c.id || !t.completion.completedAt) return false
        return new Date(t.completion.completedAt) >= startOfDay(last7)
      }).length
      const prev = rangeTasks.filter(t => {
        if (!t.completion || t.completion.categoryId !== c.id || !t.completion.completedAt) return false
        const d = new Date(t.completion.completedAt)
        return d >= startOfDay(prev7Start) && d < startOfDay(last7)
      }).length
      const pct = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : recent > 0 ? 100 : 0
      return { name: c.name, color: c.color, pct, recent, prev }
    })
    .filter(c => c.recent > 0 || c.prev > 0)

  // Quiet nudge: multiplier >= 1.5 categories with no completion in 14d
  const quietCategories = categories.filter(c => {
    if ((c.priorityMultiplier ?? 1) < 1.5) return false
    const last14 = subDays(now, 13)
    const hasRecent = rangeTasks.some(t => {
      if (!t.completion || t.completion.categoryId !== c.id || !t.completion.completedAt) return false
      return new Date(t.completion.completedAt) >= startOfDay(last14)
    })
    return !hasRecent
  })

  return (
    <>
      {isCardVisible(settings, 'difficultyMix') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>DIFFICULTY MIX</CardLabel>
          <View style={{ gap: 8 }}>
            {mixData.map(d => (
              <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Text style={{ color: theme.textSecondary, ...TYPE.caption, width: 76 }} numberOfLines={1}>
                  {d.label}
                </Text>
                <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.bgTertiary, overflow: 'hidden' }}>
                  <View style={{ width: `${d.pct}%`, height: '100%', backgroundColor: d.color }} />
                </View>
                <Text style={{ color: theme.textMuted, ...TYPE.caption, width: 34, textAlign: 'right' }}>
                  {d.pct.toFixed(0)}%
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {isCardVisible(settings, 'categoryDonut') && donutData.length > 0 ? (
        <Card theme={theme}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
            <CardLabel theme={theme}>CATEGORY BREAKDOWN</CardLabel>
            <Segmented
              theme={theme}
              value={donutMode}
              onChange={setDonutMode}
              options={[
                { label: 'Tasks', value: 'tasks' },
                { label: 'Points', value: 'points' }
              ]}
            />
          </View>
          <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' }}>
            {donutData.map(d => (
              <View key={d.name} style={{ flex: Math.max(d.value, 0.0001), backgroundColor: d.color }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginTop: SPACING.sm }}>
            {donutData.map(d => (
              <View key={d.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: d.color }} />
                <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>
                  {d.name} ({donutTotal > 0 ? Math.round((d.value / donutTotal) * 100) : 0}%)
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {isCardVisible(settings, 'topDifficulty') && topDiff ? (
        <Card theme={theme}>
          <CardLabel theme={theme}>TOP DIFFICULTY</CardLabel>
          <View
            style={{
              backgroundColor: topDiff.color,
              borderRadius: 999,
              paddingHorizontal: SPACING.lg,
              paddingVertical: 7,
              alignSelf: 'flex-start'
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 14 }}>
              {topDiffCount} x {topDiff.label}
            </Text>
          </View>
        </Card>
      ) : null}

      {isCardVisible(settings, 'alignment') && (
        <Card theme={theme}>
          <CardLabel theme={theme}>ALIGNMENT (POINTS IN MULTIPLIER &gt; 1 CATEGORIES)</CardLabel>
          <Text style={{ color: theme.textPrimary, fontSize: 28, fontWeight: '800' }}>{alignmentPct}%</Text>
        </Card>
      )}

      {isCardVisible(settings, 'momentum') && momentumData.length > 0 ? (
        <Card theme={theme}>
          <CardLabel theme={theme}>CATEGORY MOMENTUM (7D VS PREV 7D)</CardLabel>
          <View style={{ gap: 8 }}>
            {momentumData.map(c => (
              <View key={c.name} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c.color }} />
                <Text style={{ color: theme.textSecondary, ...TYPE.body, flex: 1 }} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text
                  style={{
                    color: c.pct > 0 ? '#22c55e' : c.pct < 0 ? '#ef4444' : theme.textMuted,
                    ...TYPE.bodyStrong
                  }}
                >
                  {c.pct > 0 ? '+' : ''}
                  {c.pct}%
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {isCardVisible(settings, 'quietNudge') && quietCategories.length > 0 ? (
        <Card theme={theme}>
          <CardLabel theme={theme}>QUIET CATEGORIES</CardLabel>
          <View style={{ gap: 8 }}>
            {quietCategories.map(c => {
              let latest = null
              for (const t of rangeTasks) {
                if (t.completion && t.completion.categoryId === c.id && t.completion.completedAt) {
                  const d = new Date(t.completion.completedAt)
                  if (!latest || d > latest) latest = d
                }
              }
              const daysSince = latest ? differenceInDays(now, latest) : '?'
              return (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c.color }} />
                  <Text style={{ color: theme.textSecondary, ...TYPE.caption, flex: 1 }}>
                    {c.name} has been quiet for {daysSince} days
                  </Text>
                </View>
              )
            })}
          </View>
        </Card>
      ) : null}
    </>
  )
}

// --- the Dashboard tab (desktop Dashboard default export) ----------------------

export function ReviewsDashboard({ theme, data, onDayPress }) {
  const [range, setRange] = useState('30d')

  const tasks = data.tasks || []
  const difficulties = data.difficulties || []
  const categories = data.categories || []
  const settings = data.settings || {}

  const completedTasks = useMemo(() => tasks.filter(t => t.completion), [tasks])
  const rangeTasks = useMemo(() => filterByRange(completedTasks, range), [completedTasks, range])
  const scoreCache = useMemo(
    () =>
      buildScoreCache(
        completedTasks,
        difficulties,
        categories,
        settings.fatigueIncrement || 0.10,
        settings.fatigueCap || 3.0
      ),
    [completedTasks, difficulties, categories, settings.fatigueIncrement, settings.fatigueCap]
  )

  // All-time total: chronological fatigue walk over EVERY completion
  const allTimeTotal = useMemo(() => {
    let total = 0
    const fatigueInc = settings.fatigueIncrement || 0.10
    const fatigueCap = settings.fatigueCap || 3.0
    const sorted = [...completedTasks].sort(
      (a, b) => new Date(a.completion.completedAt) - new Date(b.completion.completedAt)
    )
    let mult = 1.0
    const diffMap = new Map(difficulties.map(d => [d.id, d]))
    const catMap = new Map(categories.map(c => [c.id, c]))
    for (const t of sorted) {
      const d = diffMap.get(t.completion.difficultyId)
      const base = d ? d.score : 0
      let pm = 1.0
      if (t.completion.categoryId) {
        const cat = catMap.get(t.completion.categoryId)
        if (cat && typeof cat.priorityMultiplier === 'number') pm = cat.priorityMultiplier
      }
      total += base * mult * pm
      mult = Math.min(mult + fatigueInc, fatigueCap)
    }
    return total
  }, [completedTasks, difficulties, categories, settings.fatigueIncrement, settings.fatigueCap])

  return (
    <View>
      <Segmented theme={theme} value={range} onChange={setRange} options={RANGE_OPTIONS} accessibilityLabel="Dashboard range" />

      <GlassCard theme={theme} style={{ padding: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>
              {Math.round(allTimeTotal * 10) / 10}
            </Text>
            <Text style={{ color: theme.textMuted, ...TYPE.caption }}>all-time score</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ color: theme.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>
              {completedTasks.length}
            </Text>
            <Text style={{ color: theme.textMuted, ...TYPE.caption }}>tasks completed</Text>
          </View>
        </View>
      </GlassCard>

      {['intensity', 'records', 'rhythm', 'composition'].map(panelKey => (
        <GlassCard key={panelKey} theme={theme} style={{ padding: SPACING.md, marginBottom: SPACING.md }}>
          <Text
            style={{
              color: theme.textPrimary,
              fontWeight: '800',
              letterSpacing: 1.1,
              fontSize: 12,
              marginBottom: SPACING.md
            }}
          >
            {PANEL_TITLES[panelKey]}
          </Text>
          {panelKey === 'intensity' ? (
            <IntensityPanel
              theme={theme}
              rangeTasks={rangeTasks}
              difficulties={difficulties}
              categories={categories}
              settings={settings}
              scoreCache={scoreCache}
            />
          ) : null}
          {panelKey === 'records' ? (
            <RecordsPanel
              theme={theme}
              allCompleted={completedTasks}
              rangeTasks={rangeTasks}
              difficulties={difficulties}
              categories={categories}
              settings={settings}
              scoreCache={scoreCache}
              onDayPress={onDayPress}
            />
          ) : null}
          {panelKey === 'rhythm' ? (
            <RhythmPanel
              theme={theme}
              allCompleted={completedTasks}
              rangeTasks={rangeTasks}
              difficulties={difficulties}
              categories={categories}
              settings={settings}
              scoreCache={scoreCache}
            />
          ) : null}
          {panelKey === 'composition' ? (
            <CompositionPanel
              theme={theme}
              rangeTasks={rangeTasks}
              difficulties={difficulties}
              categories={categories}
              settings={settings}
              scoreCache={scoreCache}
            />
          ) : null}
        </GlassCard>
      ))}
    </View>
  )
}
