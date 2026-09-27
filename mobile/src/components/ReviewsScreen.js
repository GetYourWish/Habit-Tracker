// ReviewsScreen — how the routines are going (desktop ReviewsView parity):
// overall tiles + a per-habit 30-day dot grid, streaks, best streaks and
// consistency. Every number comes from @habit-tracker/core over the same
// habit.json the desktop renders from.

import React, { useMemo, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import {
  indexCompletions,
  evaluateHabitStatus,
  calculateStreak,
  calculateBestStreak,
  totalCompletions,
  describeFrequency,
  systemFrequencies
} from '@habit-tracker/core'
import { frequencyFor } from '../actions.js'
import { SPACING, TYPE } from '../theme.js'
import { GlassCard, TopAppBar, Segmented } from './ui.js'

const FALLBACK_FREQUENCY = systemFrequencies().find(f => f.key === 'daily')

const RANGES = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 }
]

function lastNDays(today, n) {
  const out = []
  const [y, m, d] = today.split('-').map(Number)
  for (let back = n - 1; back >= 0; back--) {
    const dt = new Date(Date.UTC(y, m - 1, d - back))
    const p = x => String(x).padStart(2, '0')
    out.push(`${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`)
  }
  return out
}

function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function SummaryTile({ theme, value, label, accent }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.rowFill,
        borderRadius: 12,
        padding: SPACING.md,
        alignItems: 'center',
        minWidth: 0
      }}
    >
      <Text style={{ color: accent || theme.textPrimary, fontSize: 23, fontWeight: '800', letterSpacing: -0.4 }}>
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, ...TYPE.caption, textAlign: 'center', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  )
}

export function ReviewsScreen({ theme, state, store }) {
  const data = state.data
  const [rangeDays, setRangeDays] = useState(30)

  const today = new Date().toISOString().slice(0, 10)
  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1

  const completionsByHabit = useMemo(
    () => indexCompletions(data.completions || []),
    [data.completions]
  )
  const days = useMemo(() => lastNDays(today, rangeDays), [today, rangeDays])
  const activeHabits = useMemo(
    () => (data.habits || []).filter(h => !h.archived),
    [data.habits]
  )

  // Per-habit rows: per-day counts for the dot grid (desktop rows parity).
  const rows = useMemo(() => {
    return activeHabits.map(habit => {
      const frequency = frequencyFor(data, habit) || FALLBACK_FREQUENCY
      const byDate = {}
      for (const c of completionsByHabit[habit.id] || []) {
        byDate[c.date] = (byDate[c.date] || 0) + 1
      }
      let scheduledDays = 0
      let satisfiedDays = 0
      for (const d of days) {
        const st = evaluateHabitStatus(habit, frequency, completionsByHabit, d, weekStartsOn)
        if (st.scheduled || st.goal > 1) {
          scheduledDays++
          if (st.satisfied) satisfiedDays++
        }
      }
      return {
        habit,
        frequency,
        perDay: Math.max(1, Number(habit.timesPerDay) || Number(frequency && frequency.timesPerDay) || 1),
        counts: days.map(d => byDate[d] || 0),
        streak: calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn),
        best: calculateBestStreak(habit, frequency, completionsByHabit, today, weekStartsOn),
        total: totalCompletions(habit, completionsByHabit),
        consistency: scheduledDays ? Math.round((satisfiedDays / scheduledDays) * 100) : null
      }
    })
  }, [activeHabits, data, completionsByHabit, days, today, weekStartsOn])

  // Overall tiles (desktop summary parity).
  const summary = useMemo(() => {
    let totalCheckins = 0
    let bestStreak = 0
    const byDate = {}
    for (const c of data.completions || []) {
      if (days.includes(c.date)) {
        totalCheckins++
        byDate[c.date] = (byDate[c.date] || 0) + 1
      }
    }
    for (const r of rows) if (r.best > bestStreak) bestStreak = r.best
    let perfectDays = 0
    let dayGoals = {}
    for (const r of rows) {
      const goal = Math.max(1, Number(r.frequency && r.frequency.timesPerPeriod) || 1) * r.perDay
      for (const d of days) {
        const st = evaluateHabitStatus(r.habit, r.frequency, completionsByHabit, d, weekStartsOn)
        if (st.scheduled || st.goal > 1) {
          dayGoals[d] = (dayGoals[d] || 0) + goal
        }
      }
    }
    for (const d of days) {
      if (dayGoals[d] && byDate[d] >= dayGoals[d]) perfectDays++
    }
    return { totalCheckins, bestStreak, perfectDays }
  }, [rows, days, data.completions, completionsByHabit, weekStartsOn])

  return (
    <View style={{ flex: 1 }}>
      <TopAppBar theme={theme} title="Reviews" subtitle="How your routines are going" />
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 110 }}>
        <View style={{ marginBottom: SPACING.md }}>
          <Segmented
            theme={theme}
            options={RANGES}
            value={rangeDays}
            onChange={setRangeDays}
            accessibilityLabel="Review range"
          />
        </View>

        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <SummaryTile theme={theme} value={`${summary.perfectDays}`} label="perfect days" accent={theme.flowState} />
          <SummaryTile theme={theme} value={`${summary.totalCheckins}`} label="check-ins" />
          <SummaryTile theme={theme} value={`🔥 ${summary.bestStreak}`} label="best streak" />
          <SummaryTile theme={theme} value={`${rows.length}`} label="active habits" />
        </View>

        {rows.length === 0 ? (
          <GlassCard theme={theme} style={{ padding: SPACING.xl, alignItems: 'center' }}>
            <Text style={{ fontSize: 40, marginBottom: SPACING.sm }}>🌱</Text>
            <Text style={{ color: theme.textPrimary, fontSize: 16, fontWeight: '800' }}>No habits yet</Text>
            <Text style={{ color: theme.textSecondary, ...TYPE.secondary, marginTop: 4, textAlign: 'center' }}>
              Create a habit on the Today screen and your progress will show up here.
            </Text>
          </GlassCard>
        ) : null}

        {rows.map(r => {
          const color = r.habit.color || '#34d399'
          const cadence = describeFrequency(r.frequency, r.habit)
          return (
            <GlassCard key={r.habit.id} theme={theme} style={{ padding: SPACING.lg, marginBottom: SPACING.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.sm }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withAlpha(color, 0.22)
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{r.habit.icon || '⭐'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: '700' }}>{r.habit.title}</Text>
                  <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{cadence}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: theme.textPrimary, fontSize: 14, fontWeight: '800' }}>🔥 {r.streak}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11.5 }}>best {r.best}</Text>
                </View>
              </View>

              {/* dot grid: one dot per day, brightness by completion count */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
                {r.counts.map((n, i) => (
                  <View
                    key={i}
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 4,
                      backgroundColor:
                        n >= r.perDay ? color
                          : n === 1 ? withAlpha(color, 0.6)
                            : 'rgba(128,128,128,0.16)'
                    }}
                  />
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm }}>
                <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>
                  {r.consistency == null ? '—' : `${r.consistency}%`} on schedule
                </Text>
                <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{r.total} all-time</Text>
              </View>
            </GlassCard>
          )
        })}
      </ScrollView>
    </View>
  )
}
