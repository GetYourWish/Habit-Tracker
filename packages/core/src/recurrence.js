// recurrence.js — the single source of truth for WHEN a habit is due and
// how streaks/completions are computed. Pure JS, no clock: every function
// takes dates as 'YYYY-MM-DD' strings so desktop and mobile agree exactly
// (and tests are deterministic).
//
// Data model (all user-editable — nothing here is burned into the UI):
//   frequency = {
//     id, key, label, icon, color,
//     kind: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'every-n',
//     weekdays?: [0..6]   // used by kind 'weekdays' (0 = Sunday)
//     interval?: number    // used by kind 'every-n' (every N days)
//     timesPerPeriod?: 1   // goal habits: how many completions "count" per period
//     graceDays?: 0        // extra misses tolerated before the streak breaks
//     system?: true        // restored by healing if deleted (still editable)
//   }
//   habit.frequencyId points at one of these. Changing the frequency of a
//   habit never rewrites history; streaks/due-ness are always recomputed
//   from the completion log + current frequencies.

const MS_DAY = 86400000

// ---------- date helpers (self-contained, UTC/ISO-based) ----------

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) throw new Error(`bad date: ${s}`)
  return { y: +m[1], m: +m[2], d: +m[3] }
}

function toUtc({ y, m, d }) {
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms) {
  const dt = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

function addDays(dateStr, n) {
  const { y, m, d } = parseYmd(dateStr)
  return fromUtc(toUtc({ y, m, d }) + n * MS_DAY)
}

function diffDays(a, b) {
  // a - b in whole days
  const pa = parseYmd(a); const pb = parseYmd(b)
  return Math.round((toUtc(pa) - toUtc(pb)) / MS_DAY)
}

// 0 = Sunday .. 6 = Saturday
function dayOfWeek(dateStr) {
  const { y, m, d } = parseYmd(dateStr)
  return new Date(toUtc({ y, m, d })).getUTCDay()
}

function startOfWeek(dateStr, weekStartsOn = 1) {
  const dow = dayOfWeek(dateStr)
  const delta = (dow - weekStartsOn + 7) % 7
  return addDays(dateStr, -delta)
}

function endOfWeek(dateStr, weekStartsOn = 1) {
  return addDays(startOfWeek(dateStr, weekStartsOn), 6)
}

function startOfMonth(dateStr) {
  const { y, m } = parseYmd(dateStr)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function endOfMonth(dateStr) {
  const { y, m } = parseYmd(dateStr)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

// ISO-8601 week number (weeks start Monday, week 1 contains first Thursday)
function isoWeek(dateStr) {
  const { y, m, d } = parseYmd(dateStr)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3)
  return 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * MS_DAY))
}

function isoWeekYear(dateStr) {
  const { y, m, d } = parseYmd(dateStr)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3)
  return dt.getUTCFullYear()
}

// ---------- system frequency catalogue ----------
// DEFAULTS seeded into a fresh habit.json. Plain data: the user can rename,
// recolor, delete or invent cadences. `system: true` only means healing
// restores missing entries — edits to existing ones are never overwritten.

function systemFrequencies() {
  return [
    { key: 'daily', label: 'Every day', icon: '☀️', color: '#34d399', kind: 'daily', timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'weekdays', label: 'Weekdays', icon: '💼', color: '#60a5fa', kind: 'weekdays', weekdays: [1, 2, 3, 4, 5], timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'weekends', label: 'Weekends', icon: '🌇', color: '#fbbf24', kind: 'weekdays', weekdays: [0, 6], timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'every-other-day', label: 'Every other day', icon: '🔁', color: '#2dd4bf', kind: 'every-n', interval: 2, timesPerPeriod: 1, graceDays: 1, system: true },
    { key: 'weekly', label: 'Once a week', icon: '📅', color: '#a78bfa', kind: 'weekly', timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'twice-weekly', label: 'Twice a week', icon: '✌️', color: '#f472b6', kind: 'weekly', timesPerPeriod: 2, graceDays: 0, system: true },
    { key: 'monthly', label: 'Once a month', icon: '🗓️', color: '#22d3ee', kind: 'monthly', timesPerPeriod: 1, graceDays: 0, system: true }
  ]
}

// ---------- scheduling ----------

// Is this habit SCHEDULED (due) on the given date?
function isScheduledOn(frequency, dateStr, weekStartsOn = 1) {
  if (!frequency) return false
  switch (frequency.kind) {
    case 'daily':
      return true
    case 'weekdays': {
      const days = Array.isArray(frequency.weekdays) && frequency.weekdays.length
        ? frequency.weekdays
        : [1, 2, 3, 4, 5]
      return days.includes(dayOfWeek(dateStr))
    }
    case 'weekly':
    case 'monthly':
      return true // due within the whole period; any day inside counts
    case 'every-n': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate
      if (!anchor) return true
      return ((diffDays(dateStr, anchor) % n) + n) % n === 0
    }
    default:
      return false
  }
}

// The calendar period a date belongs to, keyed per frequency kind so we can
// group completions into periods ("which week?", "which month?").
function periodKey(frequency, dateStr, weekStartsOn = 1) {
  switch (frequency && frequency.kind) {
    case 'weekly':
      return `${isoWeekYear(dateStr)}-W${String(isoWeek(dateStr)).padStart(2, '0')}`
    case 'monthly':
      return dateStr.slice(0, 7)
    case 'every-n': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate || dateStr
      const idx = Math.floor(diffDays(dateStr, anchor) / n)
      return `every${n}:${idx}`
    }
    default:
      return dateStr // daily / weekdays: one period per day
  }
}

function periodLabel(frequency, dateStr, weekStartsOn = 1) {
  switch (frequency && frequency.kind) {
    case 'weekly': {
      const s = startOfWeek(dateStr, weekStartsOn)
      const e = endOfWeek(dateStr, weekStartsOn)
      return `${s.slice(5)} → ${e.slice(5)}`
    }
    case 'monthly':
      return dateStr.slice(0, 7)
    default:
      return dateStr
  }
}

// How many completions of this habit fall inside the period containing dateStr.
function countDoneInPeriod(habit, frequency, completionsByHabit, dateStr, weekStartsOn = 1) {
  const list = completionsByHabit[habit.id] || []
  const pk = periodKey(frequency, dateStr, weekStartsOn)
  let n = 0
  for (const c of list) {
    if (periodKey(frequency, c.date, weekStartsOn) === pk) n++
  }
  return n
}

// ---------- status for one habit on one date ----------
// { scheduled, done, goal, remaining, satisfied, notDueToday, periodLabel }
function evaluateHabitStatus(habit, frequency, completionsByHabit, dateStr, weekStartsOn = 1) {
  const scheduled = isScheduledOn(frequency, dateStr, weekStartsOn)
  const goal = Math.max(1, Number(frequency && frequency.timesPerPeriod) || 1)
  const done = countDoneInPeriod(habit, frequency, completionsByHabit, dateStr, weekStartsOn)
  const remaining = Math.max(0, goal - done)
  return {
    scheduled,
    done,
    goal,
    remaining,
    satisfied: done >= goal,
    notDueToday: !scheduled && goal <= 1,
    periodLabel: periodLabel(frequency, dateStr, weekStartsOn)
  }
}

// ---------- streaks ----------
// Walk backwards from `today`. A missed scheduled day breaks the streak
// (after graceDays worth of tolerated misses). Today itself never breaks it
// while still unchecked. Non-scheduled days are skipped silently (weekend
// off for a weekdays habit). Weekly/monthly habits count consecutive
// satisfied PERIODS instead.
function calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn = 1) {
  if (!frequency) return 0
  const grace = Math.max(0, Number(frequency.graceDays) || 0)
  const doneDates = new Set((completionsByHabit[habit.id] || []).map(c => c.date))

  if (frequency.kind === 'daily' || frequency.kind === 'weekdays') {
    let streak = 0
    let misses = 0
    let cursor = today
    for (let guard = 0; guard < 3660; guard++) {
      if (isScheduledOn(frequency, cursor, weekStartsOn)) {
        if (doneDates.has(cursor)) {
          streak++
        } else if (cursor === today) {
          // today pending — does not break the streak
        } else {
          misses++
          if (misses > grace) break
        }
      }
      cursor = addDays(cursor, -1)
      if (diffDays(today, cursor) > 730) break
    }
    return streak
  }

  if (frequency.kind === 'every-n') {
    // consecutive scheduled days done, walking back; non-due days skipped
    let streak = 0
    let cursor = today
    for (let guard = 0; guard < 3660; guard++) {
      if (isScheduledOn(frequency, cursor, weekStartsOn)) {
        if (doneDates.has(cursor)) streak++
        else if (cursor !== today) break
      }
      cursor = addDays(cursor, -1)
      if (diffDays(today, cursor) > 730) break
    }
    return streak
  }

  // weekly / monthly: consecutive satisfied periods ending with the current one
  const doneCounts = {}
  for (const c of completionsByHabit[habit.id] || []) {
    const k = periodKey(frequency, c.date, weekStartsOn)
    doneCounts[k] = (doneCounts[k] || 0) + 1
  }
  const goal = Math.max(1, Number(frequency.timesPerPeriod) || 1)
  let streak = 0
  let cursor = today
  const step = frequency.kind === 'weekly' ? 7 : 28
  const currentPk = periodKey(frequency, today, weekStartsOn)
  for (let i = 0; i < 120; i++) {
    const k = periodKey(frequency, cursor, weekStartsOn)
    if ((doneCounts[k] || 0) >= goal) {
      streak++
    } else if (k === currentPk) {
      // current period still in progress — doesn't break the chain
    } else {
      break
    }
    cursor = addDays(cursor, -step)
  }
  return streak
}

// Longest run ever achieved (same rules as calculateStreak but anchored at
// every historical completion date). Used by dashboard/reviews.
function calculateBestStreak(habit, frequency, completionsByHabit, today, weekStartsOn = 1) {
  const list = (completionsByHabit[habit.id] || []).map(c => c.date).sort()
  if (!list.length || !frequency) return 0
  let best = 0
  const anchors = [...new Set([...list, today])]
  for (const a of anchors) {
    const s = calculateStreak(habit, frequency, completionsByHabit, a, weekStartsOn)
    if (s > best) best = s
  }
  return best
}

function totalCompletions(habit, completionsByHabit) {
  return (completionsByHabit[habit.id] || []).length
}

// Index completions once per render/save pass.
function indexCompletions(completions) {
  const byHabit = {}
  for (const c of completions || []) {
    if (!byHabit[c.habitId]) byHabit[c.habitId] = []
    byHabit[c.habitId].push(c)
  }
  for (const k of Object.keys(byHabit)) {
    byHabit[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }
  return byHabit
}

module.exports = {
  parseYmd,
  toUtc,
  fromUtc,
  addDays,
  diffDays,
  dayOfWeek,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isoWeek,
  systemFrequencies,
  isScheduledOn,
  periodKey,
  periodLabel,
  countDoneInPeriod,
  evaluateHabitStatus,
  calculateStreak,
  calculateBestStreak,
  totalCompletions,
  indexCompletions
}
