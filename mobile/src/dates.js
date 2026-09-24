// dates.js — the calendar math the Reviews screen needs, mirroring the
// date-fns calls the DESKTOP Reviews/Dashboard make (startOfWeek,
// eachDayOfInterval, subDays, startOfMonth, startOfYear, differenceInDays,
// …). The mobile app deliberately has NO date-fns dependency; core already
// exports the canonical parseDate/formatDate/getStartOfWeek/getEndOfWeek
// and this module layers the remaining pure-Date helpers on the same
// device-LOCAL calendar convention (see packages/core/src/dates.js): a
// calendar date is a 'YYYY-MM-DD' string; every Date here is local
// midnight unless it is an explicit completion timestamp.

import { formatDate, getStartOfWeek, getEndOfWeek } from '@habit-tracker/core'

export { formatDate, getStartOfWeek, getEndOfWeek }

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function subDays(date, n) {
  return addDays(date, -n)
}

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function eachDayOfInterval({ start, end }) {
  const out = []
  const from = startOfDay(start)
  const to = startOfDay(end)
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    out.push(new Date(d))
  }
  return out
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function startOfYear(year) {
  return new Date(year, 0, 1)
}

export function endOfYear(year) {
  return new Date(year, 11, 31, 23, 59, 59, 999)
}

export function getYear(date) {
  return date.getFullYear()
}

export function differenceInDays(later, earlier) {
  const a = startOfDay(later).getTime()
  const b = startOfDay(earlier).getTime()
  return Math.round((a - b) / 86400000)
}

export function isAfter(a, b) {
  return a.getTime() > b.getTime()
}

// --- display formatters (the format(…) tokens the desktop uses) -----------

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// 'EEE' -> Mon | 'EEEE' -> Monday
export function formatWeekday(date, long = false) {
  const names = long ? WEEKDAYS_LONG : WEEKDAYS_SHORT
  return names[date.getDay()]
}

// 'MMM d' -> Sep 5
export function formatShortDate(date) {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

// 'MMMM d, yyyy' -> September 5, 2026
export function formatLongDate(date) {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

// 'MMM d, yyyy' -> Sep 5, 2026
export function formatMediumDate(date) {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

// 'MMM yyyy' -> Sep 2026
export function formatMonthYear(date) {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

export function formatMonthShort(date) {
  return MONTHS_SHORT[date.getMonth()]
}

// 'h:mm a' -> 9:05 PM (from an instant/timestamp)
export function formatTime(date) {
  let h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${ampm}`
}

// HH:mm from an ISO string ('2026-09-22T09:05:00.000Z'.slice-equivalent),
// in the device-LOCAL time zone (what the user actually experienced).
export function isoToLocalTimeString(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatTime(d)
}
