// Date utilities shared by every client.
// Convention: calendar dates are 'YYYY-MM-DD' strings in the device-LOCAL
// calendar; instants are full ISO timestamps. No Date.now()/new Date()
// defaults live in scoring or validation paths — dates enter as arguments.

// Get current date as YYYY-MM-DD (wall-clock "today" helper for UI layers)
function getCurrentDate() {
  const now = new Date()
  return formatDate(now)
}

// Format date to YYYY-MM-DD (local calendar)
function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Parse date string
function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Get start of week
function getStartOfWeek(date, weekStartsOn = 1) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Get end of week
function getEndOfWeek(date, weekStartsOn = 1) {
  const start = getStartOfWeek(date, weekStartsOn)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

// Get week number
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// Get days in month
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

module.exports = {
  getCurrentDate,
  formatDate,
  parseDate,
  getStartOfWeek,
  getEndOfWeek,
  getWeekNumber,
  getDaysInMonth
}
