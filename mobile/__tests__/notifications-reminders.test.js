// notifications-reminders.test.js — the impure half of the reminder system
// (mobile/src/notifications/reminders.js) against a fully mocked
// expo-notifications module. The contract under test:
//   - configureReminders sets the handler + Android channel exactly once
//   - syncReminders cancels ONLY our prefixed reminders (never foreign ones)
//   - syncReminders schedules the computed plan with the identifier,
//     channel and date trigger intact
//   - a denied permission or an empty plan schedules nothing
//   - sendTestReminder respects the permission
//   - a missing/broken native module degrades to ok:false without throwing

jest.mock('expo-notifications', () => {
  const state = {
    scheduled: new Map(),
    permission: { granted: true, status: 'granted' },
    handlerSet: 0,
    channelCalls: []
  }
  const mod = {
    __state: state,
    setNotificationHandler: jest.fn(handler => {
      state.handlerSet++
      state.handler = handler
    }),
    setNotificationChannelAsync: jest.fn(async (id, opts) => {
      state.channelCalls.push(id)
      return { id }
    }),
    getPermissionsAsync: jest.fn(async () => state.permission),
    requestPermissionsAsync: jest.fn(async () => state.permission),
    getAllScheduledNotificationsAsync: jest.fn(async () =>
      [...state.scheduled.values()].map(entry => ({ identifier: entry.identifier, content: {}, trigger: null }))
    ),
    cancelScheduledNotificationAsync: jest.fn(async identifier => {
      state.scheduled.delete(identifier)
    }),
    scheduleNotificationAsync: jest.fn(async ({ identifier, content, trigger }) => {
      state.scheduled.set(identifier, { identifier, content, trigger })
      return identifier
    }),
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' }
  }
  return mod
})

import * as Notifications from 'expo-notifications'
import { syncReminders, configureReminders, sendTestReminder } from '../src/notifications/reminders.js'

const FREQ_DAILY = 'f-daily'

function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: FREQ_DAILY, key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1 }
    ],
    categories: [],
    habits: [
      {
        id: 'h-1',
        title: 'Brush teeth',
        icon: '🪥',
        frequencyId: FREQ_DAILY,
        archived: false,
        reminder: { enabled: true, time: '23:00' }
      }
    ],
    completions: [],
    board: [],
    logs: [],
    ...overrides
  }
}

const NOW = new Date(2026, 9, 22, 10, 0, 0, 0)
const TODAY = '2026-10-22'

beforeEach(() => {
  Notifications.__state.scheduled.clear()
  Notifications.__state.permission = { granted: true, status: 'granted' }
  Notifications.__state.channelCalls.length = 0
  Notifications.__state.handlerSet = 0
  jest.clearAllMocks()
})

describe('configureReminders', () => {
  test('installs the foreground handler and the Android channel (idempotently)', async () => {
    await configureReminders()
    await configureReminders()
    expect(Notifications.__state.handlerSet).toBe(1)
    expect(Notifications.__state.channelCalls).toEqual(['habit-reminders'])
  })
})

describe('syncReminders', () => {
  test('schedules the plan with deterministic ids, channel and date triggers', async () => {
    const res = await syncReminders(makeData(), NOW)
    expect(res.ok).toBe(true)
    expect(res.permitted).toBe(true)
    expect(res.scheduled).toBeGreaterThan(0)

    const ids = [...Notifications.__state.scheduled.keys()]
    expect(ids).toContain('habit-reminder-h-1-2026-10-22')
    const first = Notifications.__state.scheduled.get('habit-reminder-h-1-2026-10-22')
    expect(first.content.channelId).toBe('habit-reminders')
    expect(first.content.title).toBe('🪥 Brush teeth')
    expect(first.content.data).toEqual({ habitId: 'h-1', date: TODAY })
    // SDK 57 trigger shape: { type: 'date', date }
    expect(first.trigger.type).toBe('date')
    expect(first.trigger.date.getTime()).toBeGreaterThan(NOW.getTime())
  })

  test('cancels OUR stale reminders but never foreign notifications', async () => {
    // something else scheduled a notification (another library, the OS…)
    Notifications.__state.scheduled.set('some-other-library-id', {
      identifier: 'some-other-library-id'
    })
    Notifications.__state.scheduled.set('habit-reminder-h-1-2020-01-01', {
      identifier: 'habit-reminder-h-1-2020-01-01'
    })

    await syncReminders(makeData(), NOW)

    expect(Notifications.__state.scheduled.has('some-other-library-id')).toBe(true)
    expect(Notifications.__state.scheduled.has('habit-reminder-h-1-2020-01-01')).toBe(false)
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('habit-reminder-h-1-2020-01-01')
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('some-other-library-id')
  })

  test('an empty plan (no habit opted in) cancels stale reminders and schedules nothing', async () => {
    Notifications.__state.scheduled.set('habit-reminder-h-1-2020-01-01', {
      identifier: 'habit-reminder-h-1-2020-01-01'
    })
    const data = makeData({ habits: [{ id: 'h-1', title: 'X', frequencyId: FREQ_DAILY, archived: false }] })

    const res = await syncReminders(data, NOW)

    expect(res).toEqual({ scheduled: 0, permitted: true, ok: true })
    expect(Notifications.__state.scheduled.has('habit-reminder-h-1-2020-01-01')).toBe(false)
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  test('a denied permission schedules nothing but reports ok (graceful)', async () => {
    Notifications.__state.permission = { granted: false, status: 'denied' }
    const res = await syncReminders(makeData(), NOW)
    expect(res).toEqual({ scheduled: 0, permitted: false, ok: true })
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  test('a habit disabled globally schedules nothing', async () => {
    const data = makeData({ settings: { notifications: { enabled: false } } })
    const res = await syncReminders(data, NOW)
    expect(res.scheduled).toBe(0)
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })
})

describe('sendTestReminder', () => {
  test('fires a short-delay notification when permitted', async () => {
    const res = await sendTestReminder()
    expect(res).toEqual({ ok: true, permitted: true })
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
    const call = Notifications.scheduleNotificationAsync.mock.calls[0][0]
    expect(call.trigger.type).toBe('timeInterval')
    expect(call.trigger.seconds).toBe(5)
    expect(call.identifier.startsWith('habit-reminder-test-')).toBe(true)
  })

  test('refuses politely when permission is denied', async () => {
    Notifications.__state.permission = { granted: false, status: 'denied' }
    const res = await sendTestReminder()
    expect(res).toEqual({ ok: false, permitted: false })
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })
})
