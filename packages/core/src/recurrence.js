// recurrence.js — the single source of truth for WHEN a habit is due and
// how streaks/completions are computed. Pure JS, no clock: every function
// takes dates as 'YYYY-MM-DD' strings so desktop and mobile agree exactly
// (and tests are deterministic).
//
// Data model (all user-editable — nothing here is burned into the UI):
//   frequency = {
//     id, key, label, icon, color,
//     kind: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'every-n'
//          | 'every-n-weeks' | 'yearly',
//     weekdays?: [0..6]   // used by kind 'weekdays' (0 = Sunday)
//                          // and by 'weekly'/'every-n-weeks' to pin due days
//     monthDays?: [1..31]  // used by kind 'monthly' to pin due days of month
//     interval?: number    // used by 'every-n' (every N days) and
//                          // 'every-n-weeks' (every N weeks)
//     anchorDate?: 'YYYY-MM-DD' // phase for 'every-n' / 'every-n-weeks'
//     timesPerPeriod?: 1   // goal habits: how many completions "count" per period
//     timesPerDay?: 1      // e.g. "take medication twice a day" — on every
//                          // scheduled day the habit is due this many times
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
    { key: 'monthly', label: 'Once a month', icon: '🗓️', color: '#22d3ee', kind: 'monthly', timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'thrice-weekly', label: 'Three times a week', icon: '🎯', color: '#fb7185', kind: 'weekly', timesPerPeriod: 3, graceDays: 0, system: true },
    { key: 'mondays', label: 'Every Monday', icon: '1️⃣', color: '#38bdf8', kind: 'weekly', weekdays: [1], timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'saturdays', label: 'Every Saturday', icon: '6️⃣', color: '#fb923c', kind: 'weekly', weekdays: [6], timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'every-3-days', label: 'Every 3 days', icon: '🔁', color: '#c084fc', kind: 'every-n', interval: 3, timesPerPeriod: 1, graceDays: 1, system: true },
    { key: 'every-2-weeks', label: 'Every 2 weeks', icon: '🔂', color: '#facc15', kind: 'every-n-weeks', interval: 2, timesPerPeriod: 1, graceDays: 7, system: true },
    { key: 'twice-daily', label: 'Twice a day', icon: '✌️', color: '#2dd4bf', kind: 'daily', timesPerDay: 2, timesPerPeriod: 1, graceDays: 0, system: true },
    { key: 'yearly', label: 'Once a year', icon: '🎂', color: '#f43f5e', kind: 'yearly', timesPerPeriod: 1, graceDays: 0, system: true }
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
    case 'weekly': {
      // A weekly habit is due every day of its week UNLESS the user pinned
      // specific weekdays ("every Monday", "Mon+Thu"), in which case only
      // those days are scheduled.
      if (Array.isArray(frequency.weekdays) && frequency.weekdays.length) {
        return frequency.weekdays.includes(dayOfWeek(dateStr))
      }
      return true
    }
    case 'monthly': {
      // Due all month unless specific days-of-month were pinned (e.g. the
      // 1st and the 15th). Months shorter than a pinned day just skip it.
      if (Array.isArray(frequency.monthDays) && frequency.monthDays.length) {
        const { d } = parseYmd(dateStr)
        return frequency.monthDays.includes(d)
      }
      return true
    }
    case 'yearly': {
      // Due all year unless anchored — then only the anniversary window
      // (same month/day as the anchor) is scheduled.
      const anchor = frequency.anchorDate
      if (!anchor) return true
      return dateStr.slice(5) === anchor.slice(5)
    }
    case 'every-n': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate
      if (!anchor) return true
      return ((diffDays(dateStr, anchor) % n) + n) % n === 0
    }
    case 'every-n-weeks': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate
      if (!anchor) return true
      const weeks = Math.floor(diffDays(dateStr, anchor) / 7)
      const phase = ((weeks % n) + n) % n
      if (phase !== 0) return false
      // In its due week: all days, or only the pinned weekdays.
      if (Array.isArray(frequency.weekdays) && frequency.weekdays.length) {
        return frequency.weekdays.includes(dayOfWeek(dateStr))
      }
      return true
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
    case 'every-n-weeks': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate || startOfWeek(dateStr, weekStartsOn)
      const weeks = Math.floor(diffDays(startOfWeek(dateStr, weekStartsOn), startOfWeek(anchor, weekStartsOn)) / 7)
      const idx = Math.floor(weeks / n)
      return `every${n}w:${idx}`
    }
    case 'monthly':
      return dateStr.slice(0, 7)
    case 'yearly':
      return dateStr.slice(0, 4)
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
    case 'every-n-weeks': {
      const n = Math.max(1, Number(frequency.interval) || 1)
      const anchor = frequency.anchorDate || dateStr
      const pk = periodKey(frequency, dateStr, weekStartsOn)
      const idx = Number(pk.split(':')[1])
      const start = addDays(startOfWeek(anchor, weekStartsOn), idx * n * 7)
      const end = addDays(start, n * 7 - 1)
      return `${start.slice(5)} → ${end.slice(5)}`
    }
    case 'monthly':
      return dateStr.slice(0, 7)
    case 'yearly':
      return dateStr.slice(0, 4)
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
  // timesPerDay multiplies the bar over the whole period: "twice a day"
  // inside a week cadence means 2 × timesPerPeriod completions per week.
  const perDay = Math.max(1, Number(frequency && frequency.timesPerDay) || 1)
  const baseGoal = Math.max(1, Number(frequency && frequency.timesPerPeriod) || 1)
  const goal = baseGoal * perDay
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
  const perDay = Math.max(1, Number(frequency.timesPerDay) || 1)
  const doneDates = {}
  for (const c of completionsByHabit[habit.id] || []) {
    doneDates[c.date] = (doneDates[c.date] || 0) + 1
  }
  const daySatisfied = d => (doneDates[d] || 0) >= perDay

  if (frequency.kind === 'daily' || frequency.kind === 'weekdays') {
    let streak = 0
    let misses = 0
    let cursor = today
    for (let guard = 0; guard < 3660; guard++) {
      if (isScheduledOn(frequency, cursor, weekStartsOn)) {
        if (daySatisfied(cursor)) {
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
        if (daySatisfied(cursor)) streak++
        else if (cursor !== today) break
      }
      cursor = addDays(cursor, -1)
      if (diffDays(today, cursor) > 730) break
    }
    return streak
  }

  // weekly / every-n-weeks / monthly / yearly: consecutive satisfied
  // PERIODS ending with the current one
  const doneCounts = {}
  for (const c of completionsByHabit[habit.id] || []) {
    const k = periodKey(frequency, c.date, weekStartsOn)
    doneCounts[k] = (doneCounts[k] || 0) + 1
  }
  const goal = Math.max(1, Number(frequency.timesPerPeriod) || 1) * perDay
  let streak = 0
  let cursor = today
  const step = frequency.kind === 'weekly' ? 7 : frequency.kind === 'every-n-weeks' ? 7 * Math.max(1, Number(frequency.interval) || 1) : frequency.kind === 'yearly' ? 365 : 28
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

// Human-readable cadence sentence for chips/dialogs, built from the
// frequency DATA (not the label) so user-edited cadences describe correctly:
//   "Every day", "Every Mon · Thu", "3× per week", "Twice a day",
//   "Every 2 weeks on Sat", "Monthly on the 1st, 15th" …
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIMES_WORDS = ['', '', 'Twice', 'Thrice', '4 times', '5 times', '6 times']

function timesWord(n) {
  return TIMES_WORDS[n] || `${n} times`
}

function ordinalDay(d) {
  if (d >= 11 && d <= 13) return `${d}th`
  return `${d}` + (['th', 'st', 'nd', 'rd'][d % 10] || 'th')
}

function describeFrequency(frequency) {
  if (!frequency) return ''
  const f = frequency
  const days = Array.isArray(f.weekdays) && f.weekdays.length
    ? [...f.weekdays].sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(' · ')
    : null
  let base
  switch (f.kind) {
    case 'daily': base = 'Every day'; break
    case 'weekdays': base = days ? `Every ${days}` : 'Weekdays'; break
    case 'weekly': base = days ? `Weekly on ${days}` : 'Weekly'; break
    case 'monthly': {
      const md = Array.isArray(f.monthDays) && f.monthDays.length
        ? [...f.monthDays].sort((a, b) => a - b).map(ordinalDay).join(', ')
        : null
      base = md ? `Monthly on the ${md}` : 'Monthly'
      break
    }
    case 'yearly': base = f.anchorDate ? `Yearly (${f.anchorDate.slice(5)})` : 'Yearly'; break
    case 'every-n': base = `Every ${Math.max(1, Number(f.interval) || 1)} days`; break
    case 'every-n-weeks': {
      base = `Every ${Math.max(1, Number(f.interval) || 1)} weeks`
      if (days) base += ` on ${days}`
      break
    }
    default: base = String(f.label || '')
  }
  const perDay = Math.max(1, Number(f.timesPerDay) || 1)
  if (perDay > 1) base += ` — ${timesWord(perDay).toLowerCase()} a day`
  else if (Math.max(1, Number(f.timesPerPeriod) || 1) > 1 && (f.kind === 'weekly' || f.kind === 'every-n-weeks')) {
    base = `${timesWord(Number(f.timesPerPeriod))} per week` + (days ? ` (${days})` : '')
  } else if (Math.max(1, Number(f.timesPerPeriod) || 1) > 1 && f.kind === 'monthly') {
    base = `${timesWord(Number(f.timesPerPeriod))} per month`
  }
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// The next `count` dates (starting at `from`, inclusive) on which the habit
// is scheduled. Used by UIs to preview "next up: Mon, Thu…" and by tests.
function nextDueDates(frequency, from, count = 7, weekStartsOn = 1) {
  const out = []
  let cursor = from
  for (let guard = 0; guard < 800 && out.length < count; guard++) {
    if (isScheduledOn(frequency, cursor, weekStartsOn)) out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
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
  describeFrequency,
  nextDueDates,
  countDoneInPeriod,
  evaluateHabitStatus,
  calculateStreak,
  calculateBestStreak,
  totalCompletions,
  indexCompletions
}
