import { useMemo, useState } from 'react'
import {
  indexCompletions,
  evaluateHabitStatus,
  calculateStreak,
  describeFrequency,
  resolveTimesOfDay,
  slotForHour,
  TIME_OF_DAY_SLOTS
} from '@habit-tracker/core'

// TodayView — the app's main page: everything that should be done TODAY,
// grouped by the part of the day it belongs to. A habit set to "twice a
// day, morning + evening" (brushing teeth) shows one row per occurrence in
// its time section, each with its own check circle. Habits without a
// preferred time live in "Anytime".

const SLOT_SECTIONS = [...TIME_OF_DAY_SLOTS]
const ANYTIME = { key: 'anytime', label: 'Anytime', icon: '⏰', hint: 'whenever it fits' }

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
  // 'YYYY-MM-DD' strings, oldest first, ending today
  const out = []
  const [y, m, d] = today.split('-').map(Number)
  for (let back = 6; back >= 0; back--) {
    const dt = new Date(Date.UTC(y, m - 1, d - back))
    const p = n => String(n).padStart(2, '0')
    out.push(`${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`)
  }
  return out
}

// One checkable occurrence of a habit today.
// kind: 'slot' (a specific time-of-day) | 'multi' (one or more anytime
// occurrences collapsed into a single row) | 'resting' (not due today)
function buildOccurrence(habit, frequency, status, kind, slotKey, streak, weekCounts, count, doneCount, dayDone) {
  const base = { habit, frequency, status, kind, slotKey, streak, weekCounts, count: count || 1, dayDone: dayDone || 0 }
  if (kind === 'slot') {
    const s = status.slots.find(x => x.key === slotKey) || { key: slotKey, done: 0, satisfied: false }
    return { ...base, done: s.satisfied, doneCount: s.done }
  }
  if (kind === 'multi') {
    return { ...base, done: doneCount >= base.count, doneCount }
  }
  return { ...base, done: doneCount > 0, doneCount }
}

export default function TodayView({ data, onSave, onEditHabit, onAddHabit }) {
  const today = todayYmd()
  const nowHour = new Date().getHours()
  const currentSlot = slotForHour(nowHour)
  const [showResting, setShowResting] = useState(false)

  const freqById = useMemo(() => {
    const map = {}
    for (const f of data.frequencies || []) map[f.id] = f
    return map
  }, [data.frequencies])

  const completionsByHabit = useMemo(
    () => indexCompletions(data.completions || []),
    [data.completions]
  )

  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1

  // Per-habit derived data for today, memoized once.
  const habitsToday = useMemo(() => {
    const week = last7Days(today)
    const list = (data.habits || []).filter(h => !h.archived)
    return list.map(habit => {
      const frequency = freqById[habit.frequencyId] || null
      const status = evaluateHabitStatus(habit, frequency, completionsByHabit, today, weekStartsOn)
      const slots = resolveTimesOfDay(habit, frequency)
      const streak = calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
      const byDate = {}
      for (const c of completionsByHabit[habit.id] || []) {
        byDate[c.date] = (byDate[c.date] || 0) + 1
      }
      return {
        habit,
        frequency,
        status,
        slots,
        streak,
        weekCounts: week.map(d => byDate[d] || 0)
      }
    })
  }, [data.habits, freqById, completionsByHabit, today, weekStartsOn])

  // Bucket habits into today sections.
  //  - each declared time-of-day slot → its own row in that section
  //  - anytime occurrences (null slots, or slotless habits) → one row in
  //    "Anytime" with a ×N progress; every tap adds one completion
  const sections = useMemo(() => {
    const byKey = {}
    for (const s of SLOT_SECTIONS) byKey[s.key] = []
    const anytime = []
    const resting = []
    for (const item of habitsToday) {
      const { habit, frequency, status, slots, streak, weekCounts } = item
      if (!status.scheduled) {
        // Weekly-goal habits (e.g. 2×/week) stay visible while the period
        // still has room; otherwise today is already banked for them.
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
        byKey[key].push(buildOccurrence(habit, frequency, status, 'slot', key, streak, weekCounts, 1, 0, dayDone))
      }
      if (anytimeCount > 0) {
        anytime.push(buildOccurrence(habit, frequency, status, 'multi', null, streak, weekCounts, anytimeCount, slotlessDone, dayDone))
      }
    }
    return { byKey, anytime, resting }
  }, [habitsToday, completionsByHabit, today])

  // Header progress: every visible occurrence counts once.
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

  const toggleOccurrence = (occ) => {
    const { habit, kind, slotKey, count } = occ
    const existing = (data.completions || []).filter(c => c.habitId === habit.id && c.date === today)
    const completions = [...(data.completions || [])]
    const newId = crypto.randomUUID
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    if (kind === 'slot') {
      const matching = existing.filter(c => c.slot === slotKey)
      if (matching.length) {
        // Undo the latest check for this slot.
        const target = matching[matching.length - 1]
        const idx = completions.findIndex(c => c.id === target.id)
        if (idx >= 0) completions.splice(idx, 1)
      } else {
        completions.push({
          id: newId,
          habitId: habit.id,
          date: today,
          slot: slotKey,
          note: '',
          createdAt: new Date().toISOString()
        })
      }
    } else {
      // Anytime occurrences: tap fills one at a time up to this row's
      // share (count), then taps start removing the latest again.
      const slotless = existing.filter(c => !c.slot)
      if (slotless.length < (count || 1)) {
        completions.push({
          id: newId,
          habitId: habit.id,
          date: today,
          note: '',
          createdAt: new Date().toISOString()
        })
      } else if (slotless.length) {
        const target = slotless[slotless.length - 1]
        const idx = completions.findIndex(c => c.id === target.id)
        if (idx >= 0) completions.splice(idx, 1)
      }
    }
    onSave({
      ...data,
      completions,
      meta: { ...(data.meta || {}), updatedAt: new Date().toISOString() }
    })
  }

  const dayName = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const ringR = 34
  const ringC = 2 * Math.PI * ringR
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const ringOffset = ringC * (1 - progress.done / Math.max(1, progress.total))

  const sectionOrder = [
    ...SLOT_SECTIONS.map(s => ({ ...s, occs: sections.byKey[s.key] })),
    { ...ANYTIME, occs: sections.anytime }
  ]

  if ((data.habits || []).filter(h => !h.archived).length === 0) {
    return (
      <div className="today-wrap">
        <div className="today-empty">
          <span className="today-empty-icon">🌱</span>
          <h3>Nothing tracked yet</h3>
          <p>Create your first habit and start building your routine.</p>
          <div style={{ marginTop: 18 }}>
            <button className="btn-happy" onClick={onAddHabit}>＋ New habit</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="today-wrap">
      <div className="today-hero">
        <div className="today-hero-text">
          <div className="today-greeting">{greetingFor(nowHour)}</div>
          <div className="today-date">{dayName}</div>
          <div className="today-progress-label">
            <span className="done">{progress.done}</span> of {progress.total} done today
          </div>
        </div>
        <div className="today-progress-ring" title={`${pct}% of today's habits`}>
          <svg width="84" height="84" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r={ringR} fill="none" stroke="var(--border-color)" strokeWidth="7" />
            <circle
              cx="42" cy="42" r={ringR} fill="none"
              stroke="var(--habit-accent, #34d399)"
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={ringC}
              strokeDashoffset={ringOffset}
              style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.34, 1.2, 0.64, 1)' }}
            />
          </svg>
          <div className="today-progress-center">
            {pct}%<small>today</small>
          </div>
        </div>
      </div>

      {sectionOrder.map(section => {
        if (!section.occs.length) return null
        const isNow = SLOT_SECTIONS.some(s => s.key === section.key) && section.key === currentSlot
        const doneCount = section.occs.filter(o => o.done).length
        return (
          <div key={section.key} className={`today-section ${isNow ? 'is-now' : ''}`}>
            <div className="today-section-head">
              <span className="today-section-icon">{section.icon}</span>
              <span className="today-section-title">{section.label}</span>
              <span className="today-section-count">{doneCount}/{section.occs.length}</span>
            </div>
            {section.occs.map((occ, i) => (
              <OccurrenceRow
                key={`${occ.habit.id}-${occ.slotKey || 'any'}-${i}`}
                occ={occ}
                onToggle={() => toggleOccurrence(occ)}
                onEdit={() => onEditHabit(occ.habit)}
              />
            ))}
          </div>
        )
      })}

      {sections.resting.length > 0 && (
        <>
          <button className="today-resting-toggle" onClick={() => setShowResting(v => !v)}>
            {showResting ? '▾' : '▸'} {sections.resting.length} habit{sections.resting.length > 1 ? 's' : ''} resting today
          </button>
          {showResting && sections.resting.map(item => (
            <OccurrenceRow
              key={`rest-${item.habit.id}`}
              occ={{ ...item, kind: 'resting', slotKey: null, done: false, doneCount: 0, count: 1 }}
              onToggle={() => {
                // Bonus check-in for a habit not scheduled today (a huge
                // count makes the tap always ADD a slotless completion).
                toggleOccurrence({ ...item, kind: 'multi', slotKey: null, count: 999999 })
              }}
              onEdit={() => onEditHabit(item.habit)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function OccurrenceRow({ occ, onToggle, onEdit }) {
  const { habit, frequency, status, kind, slotKey, done, count, doneCount, dayDone } = occ
  const color = habit.color || (frequency && frequency.color) || '#34d399'
  const cadence = describeFrequency(frequency, habit)
  const streak = occ.streak ?? 0

  const slotMeta = slotKey ? TIME_OF_DAY_SLOTS.find(s => s.key === slotKey) : null
  const label = slotMeta ? slotMeta.label : 'Done'

  const weekCounts = occ.weekCounts || []
  const weekDots = kind !== 'resting' && weekCounts.length === 7 ? weekCounts : null

  // The small progress chip next to the cadence.
  const periodWord = frequency && (frequency.kind === 'weekly' || frequency.kind === 'every-n-weeks')
    ? 'this week'
    : frequency && frequency.kind === 'monthly' ? 'this month' : 'today'
  let progressChip = null
  if (kind === 'resting') {
    progressChip = <span className="habit-progress">· resting today</span>
  } else if (kind === 'multi' && count > 1) {
    progressChip = <span className="habit-progress">· {doneCount}/{count} anytime</span>
  } else if (kind === 'slot' && status.perDay > 1) {
    progressChip = <span className="habit-progress">· {dayDone}/{status.perDay} today</span>
  } else if (status.goal > 1) {
    progressChip = <span className="habit-progress">· {status.done}/{status.goal} {periodWord}</span>
  }

  return (
    <div
      className={`habit-row ${done ? 'is-done' : ''} ${kind === 'resting' ? 'is-resting' : ''}`}
      style={{ '--habit-color': color }}
    >
      <div className="habit-icon" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }} title="Edit habit" onClick={onEdit}>
        {habit.icon || '⭐'}
      </div>
      <div className="habit-main" onClick={onEdit} title="Edit habit">
        <div className="habit-title">
          <span>{habit.title}</span>
          {streak > 0 && <span className={`habit-streak ${streak >= 7 ? 'hot' : ''}`}>🔥 {streak}</span>}
        </div>
        <div className="habit-sub">
          <span className="habit-cadence">{cadence}</span>
          {progressChip}
        </div>
      </div>
      {weekDots && (
        <div className="dot-grid" style={{ '--habit-color': color }} title="Last 7 days">
          {weekDots.map((n, i) => (
            <span key={i} className={`dot-cell ${n > 1 ? 'l3' : n === 1 ? 'l2' : ''}`} />
          ))}
        </div>
      )}
      <div className="habit-actions">
        <button
          className={`slot-check ${done ? 'on' : ''}`}
          onClick={onToggle}
          title={done ? `Undo ${label.toLowerCase()} check-in` : `Check off ${label.toLowerCase()}`}
          aria-label={`${done ? 'Undo' : 'Check'} ${habit.title}${slotKey ? ` (${label})` : ''}`}
          aria-pressed={done}
        >
          <span className="slot-check-circle">{done ? '✓' : (slotMeta ? slotMeta.icon : '✓')}</span>
          <span className="slot-check-label">{slotMeta ? label.toLowerCase() : 'check'}</span>
        </button>
      </div>
    </div>
  )
}
