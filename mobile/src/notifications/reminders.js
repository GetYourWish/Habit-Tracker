// reminders.js — the impure half of the Android reminder system: everything
// that touches the expo-notifications native module lives here, behind a
// lazy require and defensive guards so that:
//   - importing this module NEVER loads native code (the Node/jest test
//     environment stays clean — same discipline as src/diagnostics.js),
//   - any scheduling failure degrades to "reminders did not update" and is
//     reported through the returned result instead of crashing the app
//     (a notification system must never take the habit tracker down).
//
// OFFLINE GUARANTEE: expo-notifications is used ONLY for LOCAL scheduled
// notifications. No push tokens are ever requested, no FCM listener is
// registered by app code, and the release build carries no INTERNET
// permission — reminders cannot reach the network even in principle.
//
// Identifier contract: every reminder we schedule uses the deterministic id
// `habit-reminder-<habitId>-<localDate>` (from plan.js). syncReminders
// cancels every scheduled notification carrying the `habit-reminder-` prefix
// and re-schedules the current plan — idempotent, order-safe, and stale
// reminders (habit deleted, time changed, habit already done today) are
// always cleaned up.

import { computeReminderPlan } from './plan.js'

export const REMINDER_CHANNEL_ID = 'habit-reminders'
const ID_PREFIX = 'habit-reminder-'

let Notifications = null
function api() {
  if (!Notifications) {
    // Lazy on purpose (see file header). In the test env without a mock
    // this require may throw — callers wrap syncReminders in .catch(), and
    // getApi() failures are contained here.
    Notifications = require('expo-notifications')
  }
  return Notifications
}

let channelReady = false
let handlerReady = false

/**
 * Idempotent one-time setup: the foreground presentation policy (reminders
 * must be visible while the app is open, not silently dropped) and the
 * Android notification channel. Call on app start; safe to call again.
 */
export async function configureReminders() {
  try {
    const n = api()
    if (!handlerReady) {
      handlerReady = true
      n.setNotificationHandler({
        handleNotification: async () => ({
          // SDK 52+ shape; unknown extra fields are ignored by older SDKs.
          shouldShowBanner: true,
          shouldShowList: true,
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false
        })
      })
    }
    if (!channelReady) {
      const chan = await n.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: 'Habit reminders',
        importance: n.AndroidImportance ? n.AndroidImportance.DEFAULT : 3,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        description: 'Daily reminders for habits you opted in'
      })
      channelReady = Boolean(chan)
    }
    return true
  } catch (e) {
    return false
  }
}

/** Current permission state (never throws). */
export async function getReminderPermission() {
  try {
    const cur = await api().getPermissionsAsync()
    return Boolean(cur && (cur.granted || cur.status === 'granted'))
  } catch (e) {
    return false
  }
}

/** Ask for POST_NOTIFICATIONS (Android 13+). Returns the final state. */
export async function requestReminderPermission() {
  try {
    const res = await api().requestPermissionsAsync()
    return Boolean(res && (res.granted || res.status === 'granted'))
  } catch (e) {
    return false
  }
}

// Trigger shims: SDK 52+ wants { type: SchedulableTriggerInputTypes.DATE,
// date }; older SDKs accepted a bare Date. Build both shapes defensively.
function dateTrigger(when) {
  const n = api()
  const T = n.SchedulableTriggerInputTypes
  return T && T.DATE ? { type: T.DATE, date: when } : when
}

function secondsTrigger(seconds) {
  const n = api()
  const T = n.SchedulableTriggerInputTypes
  return T && T.TIME_INTERVAL ? { type: T.TIME_INTERVAL, seconds } : { seconds }
}

/**
 * Make the scheduled-notification set match the current habit.json plan.
 * Cancels every reminder we previously scheduled, then schedules the fresh
 * plan (skipped entirely when notifications are not permitted — reminders
 * resume automatically after the user grants permission and any data change
 * or app foreground re-runs this sync).
 *
 * @returns {{scheduled: number, permitted: boolean, ok: boolean}}
 */
export async function syncReminders(data, now) {
  try {
    await configureReminders()
    const n = api()

    // 1. drop every stale reminder of ours
    let scheduled = []
    try {
      scheduled = await n.getAllScheduledNotificationsAsync()
    } catch (e) { /* fresh installs have none */ }
    const stale = (Array.isArray(scheduled) ? scheduled : [])
      .filter(item => item && typeof item.identifier === 'string' && item.identifier.startsWith(ID_PREFIX))
    for (const item of stale) {
      try { await n.cancelScheduledNotificationAsync(item.identifier) } catch (e) { /* already gone */ }
    }

    // 2. compute the fresh plan (pure, in plan.js)
    const plan = computeReminderPlan(data, now ? { now } : undefined)
    if (!plan.length) return { scheduled: 0, permitted: true, ok: true }

    // 3. schedule only when the app may show notifications at all
    const permitted = await getReminderPermission()
    if (!permitted) return { scheduled: 0, permitted: false, ok: true }

    let booked = 0
    // Chunked so a large plan cannot flood the JS↔native bridge in one tick.
    const CHUNK = 25
    for (let i = 0; i < plan.length; i += CHUNK) {
      const slice = plan.slice(i, i + CHUNK)
      await Promise.all(slice.map(r =>
        n.scheduleNotificationAsync({
          identifier: r.id,
          content: {
            title: r.title,
            body: r.body,
            sound: 'default',
            data: { habitId: r.habitId, date: r.date },
            channelId: REMINDER_CHANNEL_ID
          },
          trigger: dateTrigger(r.at)
        }).then(() => { booked++ }, () => { /* one failed slot must not kill the rest */ })
      ))
    }
    return { scheduled: booked, permitted: true, ok: true }
  } catch (e) {
    return { scheduled: 0, permitted: false, ok: false }
  }
}

/**
 * Fire a harmless reminder in a few seconds so the user can verify the
 * whole pipeline (channel, sound, permission) from Settings.
 */
export async function sendTestReminder() {
  await configureReminders()
  const n = api()
  const permitted = await getReminderPermission()
  if (!permitted) return { ok: false, permitted: false }
  await n.scheduleNotificationAsync({
    identifier: `${ID_PREFIX}test-${Date.now()}`,
    content: {
      title: '⏰ Habit Tracker',
      body: 'Reminders work! This is how they will look.',
      sound: 'default',
      channelId: REMINDER_CHANNEL_ID
    },
    trigger: secondsTrigger(5)
  })
  return { ok: true, permitted: true }
}
