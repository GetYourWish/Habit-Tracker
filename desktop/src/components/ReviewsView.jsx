import { useMemo, useState } from 'react'
import {
  indexCompletions,
  evaluateHabitStatus,
  calculateStreak,
  calculateBestStreak,
  totalCompletions,
  describeFrequency,
  isScheduledOn
} from '@habit-tracker/core'

// ReviewsView — how the routines are going: overall tiles + a per-habit
// 30-day dot grid, streaks, best streaks and consistency.

const RANGES = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 }
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

export default function ReviewsView({ data }) {
  const [rangeDays, setRangeDays] = useState(30)

  const today = new Date().toISOString().slice(0, 10)
  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1

  const freqById = useMemo(() => {
    const map = {}
    for (const f of data.frequencies || []) map[f.id] = f
    return map
  }, [data.frequencies])

  const completionsByHabit = useMemo(
    () => indexCompletions(data.completions || []),
    [data.completions]
  )

  const days = useMemo(() => lastNDays(today, rangeDays), [today, rangeDays])

  const activeHabits = useMemo(
    () => (data.habits || []).filter(h => !h.archived),
    [data.habits]
  )

  // Per-habit rows: per-day completion counts for the dot grid.
  const rows = useMemo(() => {
    return activeHabits.map(habit => {
      const frequency = freqById[habit.frequencyId] || null
      const byDate = {}
      for (const c of completionsByHabit[habit.id] || []) {
        byDate[c.date] = (byDate[c.date] || 0) + 1
      }
      // Consistency: share of SCHEDULED days in range that were satisfied.
      let scheduledDays = 0
      let satisfiedDays = 0
      const statusFor = (dateStr) => evaluateHabitStatus(habit, frequency, completionsByHabit, dateStr, weekStartsOn)
      for (const d of days) {
        const st = statusFor(d)
        if (st.scheduled || st.goal > 1) {
          scheduledDays++
          if (st.satisfied) satisfiedDays++
        }
      }
      const perDay = Math.max(1, Number(habit.timesPerDay) || Number(frequency && frequency.timesPerDay) || 1)
      return {
        habit,
        frequency,
        perDay,
        counts: days.map(d => byDate[d] || 0),
        streak: calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn),
        best: calculateBestStreak(habit, frequency, completionsByHabit, today, weekStartsOn),
        total: totalCompletions(habit, completionsByHabit),
        consistency: scheduledDays ? Math.round((satisfiedDays / scheduledDays) * 100) : 0
      }
    })
  }, [activeHabits, freqById, completionsByHabit, days, today, weekStartsOn])

  // Overall tiles.
  const totals = useMemo(() => {
    const completions = (data.completions || []).filter(c => days.includes(c.date)).length
    const bestStreak = rows.reduce((mx, r) => Math.max(mx, r.streak), 0)
    // A "perfect day" = every scheduled habit occurrence done.
    let perfect = 0
    for (const d of days) {
      let allDone = true
      let any = false
      for (const habit of activeHabits) {
        const frequency = freqById[habit.frequencyId] || null
        if (!frequency) continue
        const st = evaluateHabitStatus(habit, frequency, completionsByHabit, d, weekStartsOn)
        if (st.scheduled || st.goal > 1) {
          any = true
          if (!st.satisfied) { allDone = false; break }
        }
      }
      if (any && allDone) perfect++
    }
    const activeDays = new Set(
      (data.completions || []).filter(c => days.includes(c.date)).map(c => c.date)
    ).size
    return { completions, bestStreak, perfect, activeDays }
  }, [data.completions, days, activeHabits, freqById, completionsByHabit, weekStartsOn])

  if (activeHabits.length === 0) {
    return (
      <div className="reviews-wrap">
        <div className="today-empty">
          <span className="today-empty-icon">📊</span>
          <h3>Nothing to review yet</h3>
          <p>Once you track a few habits, your streaks and consistency show up here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="reviews-wrap">
      <div className="page-head">
        <div className="page-title">Reviews</div>
        <div className="chip-row">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              className={`cadence-chip ${rangeDays === r.days ? 'picked' : ''}`}
              onClick={() => setRangeDays(r.days)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-tile-value">{totals.completions}</div>
          <div className="stat-tile-label">check-ins in range</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">🔥 {totals.bestStreak}</div>
          <div className="stat-tile-label">best live streak</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">✨ {totals.perfect}</div>
          <div className="stat-tile-label">perfect days</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">{totals.activeDays}<small>/{days.length}</small></div>
          <div className="stat-tile-label">active days</div>
        </div>
      </div>

      {rows.map(({ habit, frequency, perDay, counts, streak, best, total, consistency }) => {
        const color = habit.color || (frequency && frequency.color) || '#34d399'
        return (
          <div className="review-row" key={habit.id}>
            <div className="review-head">
              <div className="habit-icon" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
                {habit.icon || '⭐'}
              </div>
              <div>
                <div className="manage-title">{habit.title}</div>
                <div className="manage-sub">{describeFrequency(frequency, habit)}</div>
              </div>
              <div className="review-numbers">
                <span title="Current streak">🔥 {streak}</span>
                <span title="Longest streak">🏆 {best}</span>
                <span title="Total check-ins">✓ {total}</span>
                <span title="Consistency on scheduled days">{consistency}%</span>
              </div>
            </div>
            <div className="dot-grid" style={{ '--habit-color': color }} title={perDay > 1 ? `up to ${perDay}× a day` : ''}>
              {counts.map((n, i) => (
                <span
                  key={i}
                  className={`dot-cell ${n >= perDay && perDay > 1 ? 'l3' : n > 1 ? 'l3' : n === 1 ? 'l2' : ''}`}
                  title={`${days[i]}: ${n} check-in${n === 1 ? '' : 's'}`}
                />
              ))}
            </div>
          </div>
        )
      })}

      <p className="editor-hint" style={{ textAlign: 'center' }}>
        Dots are darker with more check-ins. Habits due several times a day need
        all their occurrences for a full-color dot.
      </p>
    </div>
  )
}
