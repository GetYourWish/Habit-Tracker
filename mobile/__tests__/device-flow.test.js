// Device-flow regression test — reproduces the remote-reported 2026-09-18
// sequence on the FULL app tree:
//
//   boot with a CORRUPT habit.json → recovery screen → "Salvage readable
//   data" → board → create a task through the real dialog → change the
//   theme through the real Segmented control → rapid theme taps
//
// The user reported that after salvaging, creating a task "crashes" and
// changing the theme "crashes". This file drives the exact same flows through
// the mounted tree with a realistic SAF adapter; any uncaught error (which on
// a release device is a fatal crash via ErrorUtils) fails the test here.

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
// v1.0.7: no drag library to mock — the board is a plain RN FlatList.

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

// A healthy file that has REAL content (tasks, a category, difficulties) —
// the user salvaged a real file, and the flows after salvage render real rows.
function healthyRaw() {
  return JSON.stringify(
    {
      schemaVersion: 1,
      meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      settings: { theme: 'system', weekStartsOn: 1, fatigueIncrement: 0.1, fatigueCap: 3.0 },
      difficulties: [
        { id: 'd1', label: 'Easy', score: 1, color: '#4ade80', active: true, order: 0 },
        { id: 'd2', label: 'Medium', score: 2, color: '#fbbf24', active: true, order: 1 },
        { id: 'd3', label: 'Hard', score: 3, color: '#f87171', active: true, order: 2 }
      ],
      categories: [{ id: 'c1', name: 'Deep Work', color: '#8b5cf6', order: 0, active: true, priorityMultiplier: 1 }],
      markers: [{ id: 'm1', categoryId: 'c1', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
      board: [{ type: 'marker', markerId: 'm1' }, { type: 'task', taskId: 't1' }],
      tasks: [
        {
          id: 't1',
          text: 'Existing salvaged task',
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-09-01T10:00:00.000Z',
          completion: null
        }
      ],
      history: [],
      logs: []
    },
    null,
    2
  )
}

// Simulate the aftermath of the interleaved-chunk corruption incident: a
// structurally broken file (two JSON documents interleaved — "unexpected
// character" on parse).
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

// global error trap: on a release device ANY uncaught error is a fatal
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

describe('post-salvage device flow (create task / change theme)', () => {
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

  // Segmented options are Pressables with accessibilityRole="radio" whose
  // single child is the label Text. The jest Pressable mock nests instances,
  // so several test instances carry the same label — take any with a real
  // onPress.
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

  test('corrupt file → salvage → create task → change theme, all without crashing', async () => {
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

    // board is up with the salvaged task visible
    expect(findByText(tree, 'Existing salvaged task')).toBe(true)

    // 3) create a task through the real FAB + dialog
    const fab = tree.root.findByProps({ accessibilityLabel: 'Task' })
    await act(async () => {
      fab.props.onPress()
    })
    const dialogInput = tree.root.findByProps({ placeholder: 'What needs to be done?' })
    await act(async () => {
      dialogInput.props.onChangeText('A brand new task')
    })
    // submit through the Save button of the dialog
    const saveBtn = tree.root.findAllByProps({ label: 'Save' }).pop()
    await act(async () => {
      saveBtn.props.onPress()
    })
    await flushMicrotasks()

    expect(findByText(tree, 'A brand new task')).toBe(true)
    // the file on disk parses and contains the new task
    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    expect(onDisk.tasks.some(t => t.text === 'A brand new task')).toBe(true)

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
    expect(onDisk2.tasks.some(t => t.text === 'A brand new task')).toBe(true)

    expect(uncaught).toEqual([])
  })

  test('rearrange mode: move a task up, new order persists to disk', async () => {
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    mockFolderFiles.set('habit.json', healthyRaw())

    const tree = await bootApp()
    expect(findByText(tree, 'Existing salvaged task')).toBe(true)

    // enter rearrange mode via the handle on any row
    const handle = tree.root.findAllByProps({ accessibilityLabel: 'Rearrange items' })[0]
    await act(async () => {
      handle.props.onPress()
    })
    // the task sits BELOW the marker → its ↑ is enabled, the marker's is not.
    // Press the enabled one (the task's). (The jest Pressable mock nests
    // instances, so filter for a real onPress too.)
    const upButtons = tree.root.findAllByProps({ accessibilityLabel: 'Move item up' })
    const taskUp = upButtons.find(
      b => typeof b.props.onPress === 'function' && b.props.disabled !== true
    )
    expect(taskUp).toBeTruthy()
    await act(async () => {
      taskUp.props.onPress()
    })
    await flushMicrotasks()

    // exit rearrange mode (every row handle + the banner button carry the
    // label while rearranging — press the first)
    const done = tree.root.findAllByProps({ accessibilityLabel: 'Finish rearranging' })[0]
    await act(async () => {
      done.props.onPress()
    })
    await flushMicrotasks()

    const onDisk = JSON.parse(mockFolderFiles.get('habit.json'))
    // marker was index 0, task index 1 → after move-up the task is on top
    expect(onDisk.board).toEqual([
      { type: 'task', taskId: 't1' },
      { type: 'marker', markerId: 'm1' }
    ])
    expect(onDisk.tasks.some(t => t.text === 'Existing salvaged task')).toBe(true)
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
    externallyUpdated.tasks[0].text = 'Syncthing update while backgrounded'
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
    expect(findByText(tree, 'Existing salvaged task')).toBe(true)

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
    expect(onDisk.tasks.some(t => t.text === 'Existing salvaged task')).toBe(true)
    expect(uncaught).toEqual([])
  })
})
