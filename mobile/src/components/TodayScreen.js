// TodayScreen — the mobile port of desktop TodayView, the app's main page:
// everything due TODAY grouped by the part of the day it belongs to.
// A habit set to "twice a day, morning + evening" (brushing teeth) shows one
// row per occurrence in its time section, each with its own check circle.
// Habits without a preferred time live in "Anytime".
//
// Every write goes through store.mutate → rebase → verified SAF write, and
// every number comes from @habit-tracker/core over the same habit.json the
// desktop renders — byte-identical parity.

import React, { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import {
  indexCompletions,
  evaluateHabitStatus,
  calculateStreak,
  describeFrequency,
  resolveTimesOfDay,
  slotForHour,
  systemFrequencies,
  TIME_OF_DAY_SLOTS
} from '@habit-tracker/core'
import { toggleHabitCompletion, frequencyFor } from '../actions.js'
import { SPACING, TYPE } from '../theme.js'
import { GlassCard, Fab } from './ui.js'

// Fallback cadence for habits with a broken frequency reference (desktop
// TodayView parity — legacy files get working rows, never dead check rows).
const FALLBACK_FREQUENCY = systemFrequencies().find(f => f.key === 'daily')

// Time-of-day sections with Material icon names (audit: every name exists in
// the material-community glyphmap).
const SLOT_ICONS = {
  morning: 'weather-sunset-up',
  afternoon: 'white-balance-sunny',
  evening: 'weather-sunset',
  night: 'weather-night'
}

function todayYmd() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function greetingFor(hour) {
  if (hour < 5) return 'Still up? 🌙'
  if (hour < 12) return 'Good morning ☀️'
  if (hour < 17) return 'Good afternoon 🌤️'
  if (hour < 22) return 'Good evening 🌆'
  return 'Good night 🌙'
}

function last7Days(today) {
  const out = []
  const [y, m, d] = today.split('-').map(Number)
  for (let back = 6; back >= 0; back--) {
    const dt = new Date(Date.UTC(y, m - 1, d - back))
    const p = n => String(n).padStart(2, '0')
    out.push(`${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`)
  }
  return out
}

// Circular progress ring built from rotated segment Views — no svg library
// needed. 36 segments of 10° each; active segments carry the accent color.
export function ProgressRing({ size = 84, stroke = 9, progress = 0, color, track, label, sub }) {
  const SEG = 36
  const segs = []
  for (let i = 0; i < SEG; i++) {
    const active = i / SEG < progress
    segs.push(
      <View
        key={i}
        style={{ position: 'absolute', width: size, height: size, transform: [{ rotate: `${i * (360 / SEG)}deg` }] }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: size / 2 - stroke / 2,
            width: stroke,
            height: stroke,
            borderRadius: stroke / 2,
            backgroundColor: active ? color : track
          }}
        />
      </View>
    )
  }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {segs}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color, fontSize: size * 0.24, fontWeight: '800', letterSpacing: -0.5 }}>
          {label}
        </Text>
        {sub ? (
          <Text style={{ fontSize: size * 0.1, fontWeight: '600', color: track, marginTop: 1, letterSpacing: 0.4 }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// The 7-day dot strip under each habit (desktop .dot-grid parity).
function WeekDots({ counts, color }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {counts.map((n, i) => (
        <View
          key={i}
          style={{
            width: 12,
            height: 12,
            borderRadius: 4,
            backgroundColor: n > 1 ? color : n === 1 ? withAlpha(color, 0.6) : 'rgba(128,128,128,0.18)'
          }}
        />
      ))}
    </View>
  )
}

function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// One checkable occurrence of a habit today (desktop OccurrenceRow parity).
function OccurrenceRow({ theme, occ, onToggle, onEdit }) {
  const { habit, kind, slotKey, done, count, doneCount, dayDone, status } = occ
  const color = habit.color || '#34d399'
  const cadence = describeFrequency(occ.frequency, habit)
  const streak = occ.streak || 0
  const slotMeta = slotKey ? TIME_OF_DAY_SLOTS.find(s => s.key === slotKey) : null
  const label = slotMeta ? slotMeta.label : 'check'

  let progressChip = null
  if (kind === 'resting') progressChip = '· resting today'
  else if (kind === 'multi' && count > 1) progressChip = `· ${doneCount}/${count} anytime`
  else if (kind === 'slot' && status && status.perDay > 1) progressChip = `· ${dayDone}/${status.perDay} today`
  else if (status && status.goal > 1) progressChip = `· ${status.done}/${status.goal} this period`

  return (
    <GlassCard theme={theme} style={{ padding: SPACING.md, marginBottom: SPACING.sm, opacity: done ? 0.62 : 1 }}>
      <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }} onPress={onEdit} android_ripple={{ color: theme.ripple }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(color, 0.22)
          }}
        >
          <Text style={{ fontSize: 24 }}>{habit.icon || '⭐'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              numberOfLines={1}
              style={{
                color: theme.textPrimary,
                fontSize: 15.5,
                fontWeight: '700',
                textDecorationLine: done ? 'line-through' : 'none'
              }}
            >
              {habit.title}
            </Text>
            {streak > 0 ? (
              <View style={{ backgroundColor: theme.rowFill, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: streak >= 7 ? '#f97316' : theme.textSecondary }}>
                  🔥 {streak}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 2 }}>
            {cadence}{progressChip ? ` ${progressChip}` : ''}
          </Text>
        </View>
        {occ.weekCounts && occ.weekCounts.length === 7 && kind !== 'resting' ? (
          <WeekDots counts={occ.weekCounts} color={color} />
        ) : null}
        <Pressable
          onPress={onToggle}
          android_ripple={{ color, borderless: true, radius: 26 }}
          hitSlop={6}
          accessibilityLabel={`${done ? 'Undo' : 'Check'} ${habit.title}${slotKey ? ` (${label})` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ checked: !!done }}
          style={{ alignItems: 'center', gap: 2 }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              borderWidth: 2.5,
              borderColor: done ? color : theme.border,
              backgroundColor: done ? color : theme.bgSecondary,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Icon
              name={done ? 'check' : (slotKey ? (SLOT_ICONS[slotKey] || 'check') : 'check')}
              size={done ? 21 : 18}
              color={done ? '#ffffff' : theme.textSecondary}
            />
          </View>
          <Text style={{ fontSize: 10, fontWeight: '700', color: done ? color : theme.textMuted, letterSpacing: 0.2 }}>
            {slotKey ? label.toLowerCase() : 'check'}
          </Text>
        </Pressable>
      </Pressable>
    </GlassCard>
  )
}

export function TodayScreen({ theme, state, store, refreshing, onRefresh, onAddHabit, onEditHabit }) {
  const data = state.data
  const today = todayYmd()
  const nowHour = new Date().getHours()
  const currentSlot = slotForHour(nowHour)
  const [showResting, setShowResting] = useState(false)

  const completionsByHabit = useMemo(
    () => indexCompletions(data.completions || []),
    [data.completions]
  )
  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1

  // Per-habit derived data for today (desktop habitsToday parity).
  const habitsToday = useMemo(() => {
    const week = last7Days(today)
    const list = (data.habits || []).filter(h => !h.archived)
    return list.map(habit => {
      const frequency = frequencyFor(data, habit) || FALLBACK_FREQUENCY
      const status = evaluateHabitStatus(habit, frequency, completionsByHabit, today, weekStartsOn)
      const slots = resolveTimesOfDay(habit, frequency)
      const streak = calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
      const byDate = {}
      for (const c of completionsByHabit[habit.id] || []) {
        byDate[c.date] = (byDate[c.date] || 0) + 1
      }
      return { habit, frequency, status, slots, streak, weekCounts: week.map(d => byDate[d] || 0) }
    })
  }, [data, completionsByHabit, today, weekStartsOn])

  // Bucket habits into today sections (desktop sections parity).
  const sections = useMemo(() => {
    const byKey = {}
    for (const s of TIME_OF_DAY_SLOTS) byKey[s.key] = []
    const anytime = []
    const resting = []
    for (const item of habitsToday) {
      const { habit, frequency, status, slots, streak, weekCounts } = item
      if (!status.scheduled) {
        if (status.goal <= 1 || status.remaining <= 0) {
          resting.push(item)
          continue
        }
      }
      const dayComps = (completionsByHabit[habit.id] || []).filter(c => c.date === today)
      const slotlessDone = dayComps.filter(c => !c.slot).length
      const dayDone = dayComps.length
      const slotKeys = slots.filter(k => k)
      const anytimeCount = status.perDay - slotKeys.length
      for (const key of slotKeys) {
        const s = status.slots.find(x => x.key === key) || { key, done: 0, satisfied: false }
        byKey[key].push({
          ...item,
          kind: 'slot',
          slotKey: key,
          count: 1,
          dayDone,
          done: s.satisfied,
          doneCount: s.done
        })
      }
      if (anytimeCount > 0) {
        anytime.push({
          ...item,
          kind: 'multi',
          slotKey: null,
          count: anytimeCount,
          done: slotlessDone >= anytimeCount,
          doneCount: slotlessDone,
          dayDone
        })
      }
    }
    return { byKey, anytime, resting }
  }, [habitsToday, completionsByHabit, today])

  const progress = useMemo(() => {
    let total = 0
    let done = 0
    for (const key of Object.keys(sections.byKey)) {
      for (const occ of sections.byKey[key]) {
        total++
        if (occ.done) done++
      }
    }
    for (const occ of sections.anytime) {
      total++
      if (occ.done) done++
    }
    return { total, done }
  }, [sections])

  const toggle = (occ) => {
    store.mutate((d, now) =>
      toggleHabitCompletion(
        d,
        occ.kind === 'slot'
          ? { habitId: occ.habit.id, date: today, slot: occ.slotKey }
          : occ.kind === 'resting'
            ? { habitId: occ.habit.id, date: today, slot: null, count: 999999 }
            : { habitId: occ.habit.id, date: today, slot: null, count: occ.count },
        now
      )
    ).catch(() => {})
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const dayName = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const accent = theme.flowState

  if ((data.habits || []).filter(h => !h.archived).length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <Text style={{ fontSize: 52, marginBottom: SPACING.md }}>🌱</Text>
        <Text style={{ color: theme.textPrimary, fontSize: 19, fontWeight: '800' }}>Nothing tracked yet</Text>
        <Text style={{ color: theme.textSecondary, ...TYPE.secondary, marginTop: 4, textAlign: 'center' }}>
          Create your first habit and start building your routine.
        </Text>
        <View style={{ marginTop: SPACING.lg }}>
          <Fab theme={theme} label="New habit" icon="plus" onPress={onAddHabit} bottomInset={24} />
        </View>
      </View>
    )
  }

  const sectionList = [
    ...TIME_OF_DAY_SLOTS.map(s => ({ ...s, occs: sections.byKey[s.key] })),
    { key: 'anytime', label: 'Anytime', icon: '⏰', hint: 'whenever it fits', occs: sections.anytime }
  ]

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />
        }
      >
        {/* hero */}
        <GlassCard theme={theme} style={{ padding: SPACING.lg, marginBottom: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: SPACING.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>
              {greetingFor(nowHour)}
            </Text>
            <Text style={{ color: theme.textSecondary, ...TYPE.secondary, marginTop: 2 }}>{dayName}</Text>
            <Text style={{ color: theme.textPrimary, fontSize: 13.5, fontWeight: '700', marginTop: SPACING.sm }}>
              <Text style={{ color: accent }}>{progress.done}</Text> of {progress.total} done today
            </Text>
          </View>
          <ProgressRing
            size={84}
            progress={progress.total ? progress.done / progress.total : 0}
            color={accent}
            track={theme.rowFillSelected}
            label={`${pct}%`}
            sub="today"
          />
        </GlassCard>

        {sectionList.map(section => {
          if (!section.occs.length) return null
          const isNow = section.key !== 'anytime' && section.key === currentSlot
          const doneCount = section.occs.filter(o => o.done).length
          return (
            <View key={section.key} style={{ marginBottom: SPACING.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xs }}>
                <Text style={{ fontSize: 18 }}>{section.icon}</Text>
                <Text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 }}>
                  {section.label}
                </Text>
                {isNow ? (
                  <Text style={{ color: accent, fontSize: 12, fontWeight: '700' }}>· now</Text>
                ) : null}
                <View style={{ marginLeft: 'auto', backgroundColor: theme.rowFill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}>
                  <Text style={{ color: theme.textSecondary, fontSize: 11.5, fontWeight: '700' }}>
                    {doneCount}/{section.occs.length}
                  </Text>
                </View>
              </View>
              {section.occs.map((occ, i) => (
                <OccurrenceRow
                  key={`${occ.habit.id}-${occ.slotKey || 'any'}-${i}`}
                  theme={theme}
                  occ={occ}
                  onToggle={() => toggle(occ)}
                  onEdit={() => onEditHabit(occ.habit)}
                />
              ))}
            </View>
          )
        })}

        {sections.resting.length > 0 && (
          <Pressable
            onPress={() => setShowResting(v => !v)}
            style={{ alignItems: 'center', padding: SPACING.md, marginTop: SPACING.xs }}
            accessibilityRole="button"
            accessibilityLabel="Toggle resting habits"
          >
            <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: '700' }}>
              {showResting ? '▾' : '▸'} {sections.resting.length} habit{sections.resting.length > 1 ? 's' : ''} resting today
            </Text>
          </Pressable>
        )}
        {showResting && sections.resting.map(item => (
          <OccurrenceRow
            key={`rest-${item.habit.id}`}
            theme={theme}
            occ={{ ...item, kind: 'resting', slotKey: null, done: false, doneCount: 0, count: 1 }}
            onToggle={() => toggle({ ...item, kind: 'resting' })}
            onEdit={() => onEditHabit(item.habit)}
          />
        ))}
      </ScrollView>

      <Fab theme={theme} label="New habit" icon="plus" onPress={onAddHabit} />
    </View>
  )
}
