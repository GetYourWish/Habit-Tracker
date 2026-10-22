// plan.js — PURE reminder planning for the Android notification system
// (2026-10-22 user request: "users need a notification system to the android
// app… a reminder, with notification options in the settings and specific
// single-habit-based notification preferences").
//
// This module computes WHICH local notifications should exist for the next
// few weeks given the current habit.json content. It is deliberately free
// of every native import (no expo-notifications, no react-native): the
// planning rules are pure functions of (data, now) so they are fully unit
// testable and byte-portable across runtimes — same discipline as
// @habit-tracker/core. The impure half (scheduling through
// expo-notifications) lives in reminders.js.
//
// DATA MODEL (additive, schemaVersion stays 1 — healing preserves unknown
// keys on habits/settings, so no migration is needed):
//   settings.notifications = { enabled: boolean, defaultTime: 'HH:MM' }
//     - enabled defaults to true — the master switch. Nothing fires until a
//       habit opts in, so true is the least-surprising default.
//     - defaultTime is the fallback reminder time for habits that enable
//       reminders without picking their own time. Defaults to '09:00'.
//   habit.reminder = { enabled: boolean, time: 'HH:MM' | undefined }
//     - per-habit opt-in. time is optional; when absent the time derives
//       from the habit's first time-of-day slot (morning → 08:00,
//       afternoon → 13:00, evening → 18:00, night → 21:00) and finally
//       from settings.notifications.defaultTime.
//
// RULES
//   - Reminders fire ONLY on days the habit is actually due
//     (core.isScheduledOn — weekly/monthly habits are not nagged on off
//     days).
//   - A reminder already in the past (earlier today) is skipped.
//   - Today's reminder is skipped when the habit is already satisfied for
//     the current period (mark it done → no more nagging today).
//   - Reminders schedule the next PLAN_WINDOW_DAYS due days (30) and are
//     re-synced whenever habit.json changes or the app comes to the
//     foreground — reminders survive reboots (the scheduling library
//     persists them) and quietly extend their window every time the app
//     is opened.
//   - Reminders are 100% LOCAL: nothing here can or does touch the
//     network. The release build holds no INTERNET permission at all.

import {
  isScheduledOn,
  addDays,
  evaluateHabitStatus,
  indexCompletions,
  resolveTimesOfDay
} from '@habit-tracker/core'

// Default reminder hour/minute per time-of-day slot, used when a habit has
// reminders on, no explicit time, but a preferred part of day.
export const SLOT_REMINDER_TIMES = {
  morning: { h: 8, m: 0 },
  afternoon: { h: 13, m: 0 },
  evening: { h: 18, m: 0 },
  night: { h: 21, m: 0 }
}

export const DEFAULT_SETTINGS_NOTIFICATIONS = {
  enabled: true,
  defaultTime: '09:00'
}

// How many DUE days per habit the plan covers.
export const PLAN_WINDOW_DAYS = 30
// Absolute cap on planned notifications (pathological files must not
// schedule thousands of alarms).
export const PLAN_MAX_REMINDERS = 400
// Calendar-day guard for the due-day walk (a "6×/week" habit finds 30 due
// days in ~35 calendar days; 90 is plenty for any cadence).
const WALK_DAY_LIMIT = 90

const HH_MM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

export function isValidTime(hhmm) {
  return typeof hhmm === 'string' && HH_MM_RE.test(hhmm)
}

function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h, m: min }
}
export { parseTime }

export function formatTime(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// The effective global notification settings, with defaults filled in.
export function notificationSettings(data) {
  const raw = (data && data.settings && data.settings.notifications) || {}
  return {
    enabled: raw.enabled !== false,
    defaultTime: isValidTime(raw.defaultTime) ? raw.defaultTime : DEFAULT_SETTINGS_NOTIFICATIONS.defaultTime
  }
}

// The frequency a reminder plan runs on (same resolution the UI uses:
// exact id match, then the daily entry, else nothing — a habit whose
// cadence cannot be resolved gets no reminders rather than wrong ones).
function frequencyForReminders(data, habit) {
  const list = Array.isArray(data.frequencies) ? data.frequencies : []
  const direct = list.find(f => f && f.id === habit.frequencyId)
  if (direct) return direct
  return list.find(f => f && f.key === 'daily') || null
}

/**
 * The reminder time {h, m} a habit would fire at, or null when reminders
 * are off for it. Resolution order:
 *   1. habit.reminder.time ('HH:MM')
 *   2. the habit's first time-of-day slot (morning 08:00 …)
 *   3. settings.notifications.defaultTime
 *   4. '09:00'
 */
export function resolveReminderTime(habit, frequency, data) {
  if (!habit || !habit.reminder || habit.reminder.enabled !== true) return null
  const explicit = parseTime(habit.reminder.time)
  if (explicit) return explicit
  const slots = resolveTimesOfDay(habit, frequency).filter(Boolean)
  if (slots.length && SLOT_REMINDER_TIMES[slots[0]]) {
    return { ...SLOT_REMINDER_TIMES[slots[0]] }
  }
  const fallback = parseTime(notificationSettings(data).defaultTime)
  return fallback || { ...SLOT_REMINDER_TIMES.morning }
}

// Local-calendar 'YYYY-MM-DD' for a Date (same convention as the whole app).
function localYmd(date) {
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function reminderContent(habit) {
  const icon = habit.icon && String(habit.icon).trim() ? `${habit.icon} ` : ''
  return {
    title: `${icon}${habit.title || 'Habit'}`.slice(0, 120),
    body: 'Reminder: it\u2019s time to check it off.'
  }
}

/**
 * Compute the full reminder plan.
 *
 * @param {object|null} data  healed habit.json content
 * @param {object} [opts]
 * @param {Date}    [opts.now]               wall clock (tests pin this)
 * @param {string}  [opts.today]             local 'YYYY-MM-DD' override
 * @param {number}  [opts.windowDays=30]     due days covered per habit
 * @returns {Array<{id, habitId, at: Date, title, body, date}>}
 */
export function computeReminderPlan(data, opts = {}) {
  if (!data || !Array.isArray(data.habits)) return []
  const now = opts.now || new Date()
  const today = opts.today || localYmd(now)
  const windowDays = Math.max(1, Number(opts.windowDays) || PLAN_WINDOW_DAYS)
  const globalOn = notificationSettings(data).enabled
  if (!globalOn) return []

  const completionsByHabit = indexCompletions(data.completions || [])
  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1
  const plan = []

  for (const habit of data.habits) {
    if (!habit || typeof habit !== 'object' || !habit.id) continue
    if (habit.archived) continue
    if (!habit.reminder || habit.reminder.enabled !== true) continue
    const frequency = frequencyForReminders(data, habit)
    if (!frequency) continue
    const time = resolveReminderTime(habit, frequency, data)
    if (!time) continue

    // Today's reminder is skipped once the habit is satisfied for the
    // current period — checking a habit off must stop today's nagging
    // (future days stay scheduled; they cannot be predicted yet).
    const status = evaluateHabitStatus(habit, frequency, completionsByHabit, today, weekStartsOn)
    const satisfiedToday = status.satisfied

    // Walk forward collecting due days. `windowDays` is the number of
    // SCHEDULED reminders per habit — a skipped today (already satisfied,
    // or a reminder time already past) does NOT consume the quota.
    let cursor = today
    let scheduledForHabit = 0
    for (let walk = 0; walk < WALK_DAY_LIMIT && scheduledForHabit < windowDays; walk++) {
      if (isScheduledOn(frequency, cursor, weekStartsOn)) {
        const skip = cursor === today && satisfiedToday
        if (!skip) {
          const [y, mo, d] = cursor.split('-').map(Number)
          const at = new Date(y, mo - 1, d, time.h, time.m, 0, 0)
          if (at.getTime() > now.getTime()) {
            const content = reminderContent(habit)
            plan.push({
              id: `habit-reminder-${habit.id}-${cursor}`,
              habitId: habit.id,
              date: cursor,
              at,
              ...content
            })
            scheduledForHabit++
            if (plan.length >= PLAN_MAX_REMINDERS) return plan
          }
        }
      }
      cursor = addDays(cursor, 1)
    }
  }
  return plan
}
