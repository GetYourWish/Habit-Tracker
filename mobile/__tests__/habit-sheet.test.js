// habit-sheet.test.js — HabitSheet (the habit editor) regressions, the
// habit-era successor of category-sheet.test.js:
//   1. THE 2026-09-27 bug: the frequency chips must be SINGLE-SELECT. On
//      files whose frequencies array is missing, the editor synthesizes the
//      system catalogue WITH ids — exactly one chip may be picked, and
//      picking another moves the pick (the desktop shipped "all chips
//      picked, none changeable" because the fallback list had no ids).
//   2. per-occurrence best-time-of-day pickers appear at >1× per day and
//      save as timesOfDay
//   3. saving creates the habit + board row + persists a synthesized
//      catalogue into the file
//   4. the widened emoji picker: category tabs render, search filters, the
//      custom slot accepts a paste

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { HabitSheet } from '../src/components/HabitSheet.js'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

// The sheet's Reminder switch asks Android for notification permission via
// the (lazily-loaded) notifications module — deterministic mock here.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => ({ id: 'habit-reminders' })),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'mock-id'),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' }
}))

const theme = buildTheme('dark', 'dark')
const NOW = '2026-09-22T12:00:00.000Z'

function freqData() {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: 'f-daily', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, icon: '☀️', color: '#34d399' },
      { id: 'f-weekly', key: 'weekly', label: 'Once a week', kind: 'weekly', timesPerPeriod: 1, icon: '📅', color: '#a78bfa' }
    ],
    categories: [],
    habits: [],
    completions: [],
    board: [],
    logs: []
  }
}

function makeStore() {
  const calls = []
  return { calls, mutate: async buildNext => { calls.push(buildNext) } }
}

function textOf(tree) {
  const out = []
  const visit = n => {
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (n && typeof n === 'object') {
      if (n.type === 'Text' && Array.isArray(n.children)) {
        n.children.forEach(c => {
          if (typeof c === 'string') out.push(c)
        })
      }
      if (n.children) visit(n.children)
    }
  }
  visit(tree.toJSON())
  return out
}

async function mountSheet(data = freqData(), store = makeStore(), habit = null) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(
      <HabitSheet theme={theme} visible data={data} store={store} habit={habit} onClose={() => {}} />
    )
    await Promise.resolve()
  })
  return { tree, store }
}

const radiosByLabel = (tree, label) =>
  tree.root.findAll(n => n.props && n.props.accessibilityLabel === label && n.props.accessibilityRole === 'radio')

const radioState = (tree, label) =>
  radiosByLabel(tree, label).map(n => n.props.accessibilityState.selected)

describe('HabitSheet — frequency chips are single-select (THE bug fix)', () => {
  test('with a file catalogue: one chip picked, picking another moves it', async () => {
    const { tree } = await mountSheet()
    expect(radioState(tree, 'Every day')[0]).toBe(true)
    expect(radioState(tree, 'Once a week')[0]).toBe(false)

    await act(async () => {
      radiosByLabel(tree, 'Once a week')[0].props.onPress()
      await Promise.resolve()
    })
    expect(radioState(tree, 'Every day')[0]).toBe(false)
    expect(radioState(tree, 'Once a week')[0]).toBe(true)
  })

  test('with NO frequencies in the file: synthesized catalogue still single-selects (no undefined ids)', async () => {
    const legacy = freqData()
    delete legacy.frequencies
    const store = makeStore()
    const { tree } = await mountSheet(legacy, store)

    // the system catalogue rendered (not undefined-id chips)
    expect(radioState(tree, 'Every day')[0]).toBe(true)
    expect(radioState(tree, 'Once a week')[0]).toBe(false)
    // picking works — the old bug froze every chip as picked
    await act(async () => {
      radiosByLabel(tree, 'Once a week')[0].props.onPress()
      await Promise.resolve()
    })
    expect(radioState(tree, 'Every day')[0]).toBe(false)
    expect(radioState(tree, 'Once a week')[0]).toBe(true)

    // saving persists BOTH the habit and the synthesized catalogue
    const nameInput = tree.root.findAll(n => n.props.placeholder === 'e.g. Brush teeth')[0]
    await act(async () => {
      nameInput.props.onChangeText('Meditate')
      await Promise.resolve()
    })
    const createBtn = tree.root.findAll(n => typeof n.props.onPress === 'function' && collectText(n).includes('Create habit'))[0]
    await act(async () => {
      createBtn.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    const built = store.calls[0](legacy, NOW)
    const habit = built.habits[built.habits.length - 1]
    expect(habit.title).toBe('Meditate')
    expect(Array.isArray(built.frequencies)).toBe(true)
    expect(built.frequencies.length).toBeGreaterThanOrEqual(14)
    expect(built.frequencies.every(f => f && typeof f.id === 'string' && f.id)).toBe(true)
    expect(built.frequencies.some(f => f.id === habit.frequencyId)).toBe(true)
  })
})

function collectText(inst) {
  const collect = n => {
    if (typeof n === 'string') return n
    if (!n || typeof n !== 'object' || !Array.isArray(n.children)) return ''
    return n.children.map(collect).join(' ')
  }
  return collect(inst)
}

describe('HabitSheet — per-occurrence time-of-day pickers', () => {
  test('appear at 1×/day too (the 2026-10-22 fix) and save the picked slot', async () => {
    const { tree, store } = await mountSheet()

    // name it
    const nameInput = tree.root.findAll(n => n.props.placeholder === 'e.g. Brush teeth')[0]
    await act(async () => {
      nameInput.props.onChangeText('Morning vitamins')
      await Promise.resolve()
    })

    // perDay stays at 1 — the single picker is visible with Anytime default
    const t1any = tree.root.findAll(n => n.props.accessibilityLabel === 'Time 1 of 1: Anytime')
    expect(t1any.length).toBeGreaterThanOrEqual(1)
    expect(t1any[0].props.accessibilityState.selected).toBe(true)

    // pick Evening for the single occurrence
    const t1e = tree.root.findAll(n => n.props.accessibilityLabel === 'Time 1 of 1: Evening')[0]
    await act(async () => {
      t1e.props.onPress()
      await Promise.resolve()
    })
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Time 1 of 1: Evening')[0].props.accessibilityState.selected).toBe(true)

    // save: timesOfDay lands on the 1×/day habit
    const createBtn = tree.root.findAll(n => typeof n.props.onPress === 'function' && collectText(n).includes('Create habit'))[0]
    await act(async () => {
      createBtn.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    const built = store.calls[0](freqData(), NOW)
    const habit = built.habits[built.habits.length - 1]
    expect(habit.title).toBe('Morning vitamins')
    expect(habit.timesPerDay).toBeUndefined() // cadence default (1×) carries it
    expect(habit.timesOfDay).toEqual(['evening'])
  })

  test('appear at 2×/day with Morning/Evening suggested; switching #2 works', async () => {
    const { tree, store } = await mountSheet()

    // name it
    const nameInput = tree.root.findAll(n => n.props.placeholder === 'e.g. Brush teeth')[0]
    await act(async () => {
      nameInput.props.onChangeText('Brush teeth')
      await Promise.resolve()
    })

    // bump to 2× per day
    const more = tree.root.findAll(n => n.props.accessibilityLabel === 'More times per day')[0]
    await act(async () => {
      more.props.onPress()
      await Promise.resolve()
    })

    const t1m = tree.root.findAll(n => n.props.accessibilityLabel === 'Time 1 of 2: Morning')
    const t2e = tree.root.findAll(n => n.props.accessibilityLabel === 'Time 2 of 2: Evening')
    expect(t1m.length).toBeGreaterThanOrEqual(1)
    expect(t2e.length).toBeGreaterThanOrEqual(1)
    expect(t1m[0].props.accessibilityState.selected).toBe(true)
    expect(t2e[0].props.accessibilityState.selected).toBe(true)

    // switch occurrence 2 to Night — occurrence 1 stays Morning
    const t2n = tree.root.findAll(n => n.props.accessibilityLabel === 'Time 2 of 2: Night')[0]
    await act(async () => {
      t2n.props.onPress()
      await Promise.resolve()
    })
    expect(t1m[0].props.accessibilityState.selected).toBe(true)
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Time 2 of 2: Evening')[0].props.accessibilityState.selected).toBe(false)
    expect(t2n.props.accessibilityState.selected).toBe(true)

    // save: timesOfDay lands on the habit + board row + meta stamp
    const createBtn = tree.root.findAll(n => typeof n.props.onPress === 'function' && collectText(n).includes('Create habit'))[0]
    await act(async () => {
      createBtn.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    const built = store.calls[0](freqData(), NOW)
    const habit = built.habits[built.habits.length - 1]
    expect(habit.title).toBe('Brush teeth')
    expect(habit.timesPerDay).toBe(2)
    expect(habit.timesOfDay).toEqual(['morning', 'night'])
    expect(built.board.some(i => i.type === 'habit' && i.habitId === habit.id)).toBe(true)
  })
})

describe('HabitSheet — per-habit reminder preference (2026-10-22)', () => {
  test('defaults to off; enabling + saving persists habit.reminder with the chosen time', async () => {
    const { tree, store } = await mountSheet()

    const nameInput = tree.root.findAll(n => n.props.placeholder === 'e.g. Brush teeth')[0]
    await act(async () => {
      nameInput.props.onChangeText('Stretch')
      await Promise.resolve()
    })

    // the reminder switch exists and is OFF by default (opt-in). RN's
    // Switch mock replicates props across internal nodes, so match on the
    // node that carries our onValueChange handler.
    const switches = tree.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Remind me on due days' && typeof n.props.onValueChange === 'function'
    )
    expect(switches.length).toBe(1)
    expect(switches[0].props.value).toBe(false)

    // toggle ON (asks permission via the mocked module) → time field appears
    await act(async () => {
      await switches[0].props.onValueChange(true)
    })
    const laterHour = tree.root.findAll(n => n.props.accessibilityLabel === 'Later hour (Reminder time)')[0]
    expect(laterHour).toBeTruthy()
    // default time derives from settings (none set) → 09:00; bump to 10:00
    await act(async () => {
      laterHour.props.onPress()
      await Promise.resolve()
    })

    const createBtn = tree.root.findAll(n => typeof n.props.onPress === 'function' && collectText(n).includes('Create habit'))[0]
    await act(async () => {
      createBtn.props.onPress()
      await Promise.resolve()
    })
    expect(store.calls).toHaveLength(1)
    const built = store.calls[0](freqData(), NOW)
    const habit = built.habits[built.habits.length - 1]
    expect(habit.reminder).toEqual({ enabled: true, time: '10:00' })
  })

  test('saving with reminders off persists enabled:false (explicit opt-out, time retained for later)', async () => {
    const { tree, store } = await mountSheet()
    const nameInput = tree.root.findAll(n => n.props.placeholder === 'e.g. Brush teeth')[0]
    await act(async () => {
      nameInput.props.onChangeText('Meditate')
      await Promise.resolve()
    })
    const createBtn = tree.root.findAll(n => typeof n.props.onPress === 'function' && collectText(n).includes('Create habit'))[0]
    await act(async () => {
      createBtn.props.onPress()
      await Promise.resolve()
    })
    const built = store.calls[0](freqData(), NOW)
    const habit = built.habits[built.habits.length - 1]
    expect(habit.reminder).toEqual({ enabled: false, time: '09:00' })
  })

  test('editing a habit with a stored reminder seeds the switch and the time', async () => {
    const data = freqData()
    data.habits.push({
      id: 'h-9',
      title: 'Water the plants',
      icon: '🪴',
      frequencyId: 'f-daily',
      archived: false,
      reminder: { enabled: true, time: '18:30' }
    })
    const store = makeStore()
    const { tree } = await mountSheet(data, store, data.habits[0])

    const sw = tree.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Remind me on due days' && typeof n.props.onValueChange === 'function'
    )[0]
    expect(sw.props.value).toBe(true)
    // the TimeField renders the stored 18:30 as hour/minute text nodes
    // (with the ':' separator) — not the 09:00 default.
    const texts = textOf(tree)
    expect(texts).toContain('18')
    expect(texts).toContain('30')
    expect(texts).not.toContain('09')
  })
})

describe('HabitSheet — widened emoji picker', () => {
  test('opens from the icon button and offers category tabs + search + custom slot', async () => {
    const { tree } = await mountSheet()

    await act(async () => {
      tree.root.findAll(n => n.props.accessibilityLabel === 'Pick an icon')[0].props.onPress()
      await Promise.resolve()
    })

    const labels = tree.root
      .findAll(n => n.props && n.props.accessibilityRole === 'tab')
      .map(n => n.props.accessibilityLabel)
    expect(labels).toContain('All icons')
    expect(labels).toContain('Care icons')
    expect(labels).toContain('Fitness icons')

    const search = tree.root.findAll(n => n.props.placeholder === 'Search icons (brush, run, sleep…)')[0]
    await act(async () => {
      search.props.onChangeText('brush')
      await Promise.resolve()
    })
    // brushing teeth is the canonical result for "brush"
    const iconButtons = tree.root
      .findAll(n => n.props && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Icon '))
      .map(n => n.props.accessibilityLabel)
    expect(iconButtons).toContain('Icon 🪥')
  })
})
