// @habit-tracker/core — the single source of truth for every business
// rule the desktop and Android apps must agree on: recurrence/streaks,
// schema gate, validation/healing, dates, defaults, starter presets, IDs.
//
// PURITY CONTRACT: this package must stay pure JavaScript. No fs/path/os or
// any other Node builtin, no Electron, no React, no react-native. Runtime
// dependencies allowed: date-fns and uuid only. Enforced by eslint.config.js
// (no-restricted-imports / no-restricted-globals) and CI.
//
// Dates enter scoring/validation as arguments; no Date.now() in logic paths.

const { generateId } = require('./src/ids')
const { sanitizeInput } = require('./src/sanitize')
const {
  getCurrentDate,
  formatDate,
  parseDate,
  getStartOfWeek,
  getEndOfWeek,
  getWeekNumber,
  getDaysInMonth
} = require('./src/dates')
const {
  fatigueMultiplier,
  calculateTaskScoreBreakdown,
  calculateDayScore,
  groupTasksByDate
} = require('./src/scoring')
const { getTaskCategory } = require('./src/categories')
const { createDefaultData } = require('./src/defaults')
const { checkSchemaVersion, validateAndHealData } = require('./src/schema')
const recurrence = require('./src/recurrence')
const times = require('./src/times')
const { STARTER_GROUPS, STARTER_HABITS } = require('./src/presets')

module.exports = {
  // ids
  generateId,
  // sanitize
  sanitizeInput,
  // dates
  getCurrentDate,
  formatDate,
  parseDate,
  getStartOfWeek,
  getEndOfWeek,
  getWeekNumber,
  getDaysInMonth,
  // legacy scoring (kept so old task data stays readable)
  fatigueMultiplier,
  calculateTaskScoreBreakdown,
  calculateDayScore,
  groupTasksByDate,
  getTaskCategory,
  // defaults + presets
  createDefaultData,
  STARTER_GROUPS,
  STARTER_HABITS,
  // schema
  checkSchemaVersion,
  validateAndHealData,
  // recurrence engine (canonical habit math)
  systemFrequencies: recurrence.systemFrequencies,
  isScheduledOn: recurrence.isScheduledOn,
  periodKey: recurrence.periodKey,
  periodLabel: recurrence.periodLabel,
  countDoneInPeriod: recurrence.countDoneInPeriod,
  evaluateHabitStatus: recurrence.evaluateHabitStatus,
  calculateStreak: recurrence.calculateStreak,
  calculateBestStreak: recurrence.calculateBestStreak,
  totalCompletions: recurrence.totalCompletions,
  indexCompletions: recurrence.indexCompletions,
  describeFrequency: recurrence.describeFrequency,
  nextDueDates: recurrence.nextDueDates,
  addDays: recurrence.addDays,
  diffDays: recurrence.diffDays,
  dayOfWeek: recurrence.dayOfWeek,
  startOfWeekOf: recurrence.startOfWeek,
  endOfWeekOf: recurrence.endOfWeek,
  // time-of-day slots ("N times a day" habits)
  SLOT_KEYS: times.SLOT_KEYS,
  TIME_OF_DAY_SLOTS: times.TIME_OF_DAY_SLOTS,
  isValidSlotKey: times.isValidSlotKey,
  slotInfo: times.slotInfo,
  slotForHour: times.slotForHour,
  effectiveTimesPerDay: times.effectiveTimesPerDay,
  resolveTimesOfDay: times.resolveTimesOfDay,
  countSlotDoneOnDate: times.countSlotDoneOnDate
}
