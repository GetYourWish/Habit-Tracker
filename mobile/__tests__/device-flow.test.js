// device-flow.test.js — full-app flow on the habit model (the successor of
// the task-era flow): corrupt file → salvage → Today up → create a habit
// through the real sheet → change theme → Syncthing reload. Everything runs
// against the real App tree with the real store + a mocked SAF adapter, so
// the whole pipeline (load → heal → mutate → rebase → write) executes
// exactly as on device.
//
// The v1.0.8 regression this file was born from still applies: after
// salvaging, creating data "crashes" — any uncaught error here fails the
// test the same way it would kill a release build.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import App from '../App'
import { setCorruptSettleForTests } from '../src/storage/store.js'

// The corrupt-file settle window is real wall-clock time on a device
// (700 ms × 3 retries). The corrupted-file flows below must reach the
// recovery screen within the test's microtask flushes, so the settle is
// collapsed to instant retries here — the settle behavior itself is
// covered by store.test.js with a controlled adapter.
setCorruptSettleForTests({ attempts: 2, delayMs: 0 })

jest.mock('react-native-safe-area-context', () => {
  const React = require('react')
  const insets = { top: 0, bottom: 0, left: 0, right: 0 }
  const frame = { width: 320, height: 640, x: 0, y: 0 }
  const InsetsCtx = React.createContext(insets)
  const FrameCtx = React.createContext(frame)
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }) =>
      React.createElement(
        InsetsCtx.Provider,
        { value: insets },
        React.createElement(FrameCtx.Provider, { value: frame }, children)
      ),
    SafeAreaInsetsContext: InsetsCtx,
    SafeAreaFrameContext: FrameCtx,
    SafeAreaConsumer: InsetsCtx.Consumer,
    initialWindowMetrics: { insets, frame },
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    withSafeAreaInsets: Wrapped => props => React.createElement(Wrapped, { ...props, insets })
  }
})
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

const SAVED_FOLDER =
  'content://com.android.externalstorage.documents/tree/primary%3ASyncthing%2FTracker'
const mockFolderFiles = new Map()
const mockAppFiles = new Map() // app-private (backups/corrupt evidence), keyed by full file:// URI

// The adapter mock mirrors the FIXED production adapter contract: appListDir
// returns FULL URIs (saf.js normalizes Android's bare-name readDirectoryAsync
// results — the device-parity regression test for that normalization lives in
// saf.test.js against the REAL appListDir).
function mockDocUriFor(name) {
  return SAVED_FOLDER + '/document/' + encodeURIComponent('primary:Syncthing/Tracker/' + name)
}
jest.mock('../src/storage/saf.js', () => {
  const actual = jest.requireActual('../src/storage/saf.js')
  return {
    ...actual,
    createSafAdapter: () => ({
      listChildren: async () => [...mockFolderFiles.keys()].map(mockDocUriFor),
      createDocument: async (dirUri, name) => {
        mockFolderFiles.set(name, '')
        return mockDocUriFor(name)
      },
      removeDocument: async uri => {
        mockFolderFiles.delete(actual.fileNameOf(uri))
      },
      readDocument: async uri => {
        const c = mockFolderFiles.get(actual.fileNameOf(uri))
        if (c === undefined) throw new Error('Document not found: ' + uri)
        return c
      },
      writeDocument: async (uri, content) => {
        mockFolderFiles.set(actual.fileNameOf(uri), content)
      },
      statDocument: async uri => {
        const c = mockFolderFiles.get(actual.fileNameOf(uri))
        return c === undefined ? null : { exists: true, size: c.length, modificationTime: 1 }
      },
      fileNameOf: actual.fileNameOf,
      appDocumentsDir: () => 'file://data/user/0/pt/docs/',
      ensureAppDir: async dir => {
        mockAppFiles.set(dir + '.kept', 'dir')
      },
      appWriteFile: async (uri, content) => {
        mockAppFiles.set(uri, content)
      },
      // full URIs, like the FIXED production adapter returns
      appListDir: async dir => [...mockAppFiles.keys()].filter(k => k.startsWith(dir)),
      appDelete: async uri => {
        mockAppFiles.delete(uri)
      }
    })
  }
})

// A healthy habit-model file — the flows after salvage render real rows.
function healthyRaw() {
  return JSON.stringify(
    {
      schemaVersion: 1,
      meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      settings: { theme: 'system', weekStartsOn: 1 },
      frequencies: [
        { id: 'f-daily', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, icon: '☀️', color: '#34d399' }
      ],
      categories: [{ id: 'c1', name: 'Morning', color: '#34d399', order: 0, archived: false }],
      habits: [
        { id: 'h1', title: 'Existing salvaged habit', icon: '⭐', color: '#fbbf24', frequencyId: 'f-daily', categoryId: 'c1', archived: false, order: 0, createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 'h2', title: 'Second habit', icon: '💧', color: '#22d3ee', frequencyId: 'f-daily', archived: false, order: 1, createdAt: '2026-09-01T10:00:00.000Z' }
      ],
      completions: [],
      board: [{ type: 'habit', habitId: 'h1' }, { type: 'habit', habitId: 'h2' }],
      logs: []
    },
    null,
    2
  )
}

// Interleaved-chunk corruption aftermath: "unexpected character" on parse.
function corruptRaw() {
  const good = healthyRaw()
  return good.slice(0, Math.floor(good.length * 0.55)) + '"s' + good.slice(Math.floor(good.length * 0.5))
}

async function flushMicrotasks(times = 14) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function collectTexts(node, out = []) {
  if (node == null) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    node.forEach(child => collectTexts(child, out))
    return out
  }
  if (node.children) collectTexts(node.children, out)
  return out
}

// Global error trap: on a release device ANY uncaught error is a fatal
// crash (ErrorUtils → CrashLogProvider → process death). Fail the test on
// the same class of problem.
let uncaught = []
beforeAll(() => {
  const orig = console.error
  console.error = (...args) => {
    const first = String(args[0] || '')
    if (first.startsWith('The above error occurred')) uncaught.push(args.map(String).join(' '))
    orig(...args)
  }
})
afterEach(() => {
  uncaught = []
})

describe('post-salvage device flow (create habit / change theme)', () => {
  const mountedTrees = []
  afterEach(async () => {
    while (mountedTrees.length) {
      const t = mountedTrees.pop()
      act(() => {
        t.unmount()
      })
    }
    await AsyncStorage.clear()
    mockFolderFiles.clear()
    mockAppFiles.clear()
    jest.useRealTimers()
  })

  async function bootApp() {
    let tree = null
    await act(async () => {
      tree = TestRenderer.create(<App />)
      await Promise.resolve()
    })
    await flushMicrotasks()
    mountedTrees.push(tree)
    return tree
  }

  function findByText(tree, needle) {
    return collectTexts(tree.toJSON()).join(' | ')
      .toLowerCase()
      .includes(needle.toLowerCase())
  }

  function findRadioByLabel(tree, label) {
    const radios = tree.root.findAllByProps({ accessibilityRole: 'radio' })
    const hit = radios.filter(r => {
      if (typeof r.props.onPress !== 'function') return false
      const texts = collectTexts(Array.isArray(r.children) ? r.children : [r.children]).join('')
      return texts === label
    })
    if (hit.length < 1) throw new Error(`no radio labeled "${label}"`)
    return hit[0]
  }

  function findPressableContaining(tree, label) {
    const hit = tree.root.findAll(n => {
      if (!n.props || typeof n.props.onPress !== 'function') return false
      return collectTexts(Array.isArray(n.children) ? n.children : [n.children]).includes(label)
    })
    if (hit.length < 1) throw new Error(`no pressable containing "${label}"`)
    return hit[0]
  }

  test('corrupt file → salvage → create habit → change theme, all without crashing', async () => {
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', corruptRaw())

    const tree = await bootApp()

    // 1) recovery screen is up
    expect(findByText(tree, 'Could not load habit.json')).toBe(true)

    // 2) salvage through the real button
    const salvageBtn = tree.root.findByProps({ label: 'Salvage readable data' })
    await act(async () => {
      await salvageBtn.props.onPress()
    })
    await flushMicrotasks()

    // Today is up with the salvaged habit visible
    expect(findByText(tree, 'Existing salvaged habit')).toBe(true)

    // 3) create a habit through the real FAB + sheet
    const fab = tree.root.findAllByProps({ accessibilityLabel: 'New habit' })[0]
    await act(async () => {
      fab.props.onPress()
    })
    const sheetInput = tree.root.findByProps({ placeholder: 'e.g. Brush teeth' })
    await act(async () => {
      sheetInput.props.onChangeText('A brand new habit')
    })
    const createBtn = findPressableContaining(tree, 'Create habit')
    await act(async () => {
      createBtn.props.onPress()
    })
    await flushMicrotasks()

    expect(findByText(tree, 'A brand new habit')).toBe(true)
    // the file on disk parses and contains the new habit
    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk.habits.some(h => h.title === 'A brand new habit')).toBe(true)

    // 4) change the theme through the real Segmented control (Settings tab)
    const settingsTab = tree.root.findByProps({ accessibilityLabel: 'Settings' })
    await act(async () => {
      settingsTab.props.onPress()
    })
    const darkRadio = findRadioByLabel(tree, 'Dark')
    await act(async () => {
      darkRadio.props.onPress()
    })
    await flushMicrotasks()

    // still mounted, no crash, theme applied (data written back)
    const onDisk2 = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk2.settings.theme).toBe('dark')
    expect(onDisk2.habits.some(h => h.title === 'A brand new habit')).toBe(true)

    expect(uncaught).toEqual([])
  })

  test('reorder: move a habit up on the Habits tab, new order persists to disk', async () => {
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', healthyRaw())

    const tree = await bootApp()
    expect(findByText(tree, 'Existing salvaged habit')).toBe(true)

    const habitsTab = tree.root.findByProps({ accessibilityLabel: 'Habits' })
    await act(async () => {
      habitsTab.props.onPress()
    })

    // Second habit sits below the first → its ↑ is enabled
    const upButtons = tree.root.findAllByProps({ accessibilityLabel: 'Move Second habit up' })
    const up = upButtons.find(b => typeof b.props.onPress === 'function' && b.props.disabled !== true)
    expect(up).toBeTruthy()
    await act(async () => {
      up.props.onPress()
    })
    await flushMicrotasks()

    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk.board).toEqual([
      { type: 'habit', habitId: 'h2' },
      { type: 'habit', habitId: 'h1' }
    ])
    expect(uncaught).toEqual([])
  })

  test('theme selection flips instantly (optimistic) and persists after the write', async () => {
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', healthyRaw())

    const tree = await bootApp()
    const settingsTab = tree.root.findByProps({ accessibilityLabel: 'Settings' })
    await act(async () => {
      settingsTab.props.onPress()
    })

    const dark = findRadioByLabel(tree, 'Dark')
    await act(async () => {
      dark.props.onPress()
      // OPTIMISTIC: without awaiting any write, the Dark option must already
      // read as selected — the old build showed zero feedback for the entire
      // SAF write cycle (~1–2 s on device)
      await Promise.resolve()
    })
    const darkNow = findRadioByLabel(tree, 'Dark')
    const state = darkNow.props.accessibilityState
    expect(state && state.selected).toBe(true)

    await flushMicrotasks()

    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk.settings.theme).toBe('dark')
  })

  test('returning to the foreground immediately reloads a Syncthing update', async () => {
    let foregroundListener = null
    const remove = jest.fn()
    const appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'change') foregroundListener = listener
      return { remove }
    })
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', healthyRaw())

    const tree = await bootApp()
    expect(typeof foregroundListener).toBe('function')

    const externallyUpdated = JSON.parse(mockFolderFiles.get('habit.json'))
    externallyUpdated.habits[0].title = 'Syncthing update while backgrounded'
    mockFolderFiles.set('habit.json', JSON.stringify(externallyUpdated))

    await act(async () => {
      foregroundListener('active')
    })
    await flushMicrotasks()

    expect(findByText(tree, 'Syncthing update while backgrounded')).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    appStateSpy.mockRestore()
  })

  test('rapid theme taps after salvage never corrupt and never crash', async () => {
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', corruptRaw())

    const tree = await bootApp()
    const salvageBtn = tree.root.findByProps({ label: 'Salvage readable data' })
    await act(async () => {
      await salvageBtn.props.onPress()
    })
    await flushMicrotasks()
    expect(findByText(tree, 'Existing salvaged habit')).toBe(true)

    // switch to settings and tap all three theme options in a rapid burst
    const settingsTab = tree.root.findByProps({ accessibilityLabel: 'Settings' })
    await act(async () => {
      settingsTab.props.onPress()
    })
    const system = findRadioByLabel(tree, 'System')
    const light = findRadioByLabel(tree, 'Light')
    const dark = findRadioByLabel(tree, 'Dark')
    await act(async () => {
      light.props.onPress()
      dark.props.onPress()
      system.props.onPress()
      dark.props.onPress()
    })
    await flushMicrotasks()

    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk.settings.theme).toBe('dark')
    expect(onDisk.habits.some(h => h.title === 'Existing salvaged habit')).toBe(true)
    expect(uncaught).toEqual([])
  })
})
