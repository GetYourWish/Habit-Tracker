// Full boot pipeline test — mounts <App> with a fully self-contained
// safe-area-context mock (own React contexts, zero requireActual) and asserts
// the whole first-run flow resolves to the SetupScreen:
//   boot splash → AsyncStorage empty → status 'no-folder' → SetupScreen(fresh)
//
// The crash-regression guard (REAL context, throws without a provider, root
// element must be the provider) lives in app-boot.test.js; this file proves
// the tree actually RENDERS once the provider is in place.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import App from '../App'

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
// v1.0.7: the drag-and-drop stack (draggable-flatlist + reanimated +
// worklets + gesture-handler) is GONE — the board renders a plain RN
// FlatList, so no component mocks are needed for the full tree anymore.
// (The old mocks had to mirror the drag library's real export shape because
// an honest mock once caught a silently-undefined import; with the library
// removed, that entire failure class is structurally impossible.)

// Realistic SAF adapter: child URIs shaped exactly like a real Android
// external-storage document provider (percent-encoded document ids), so the
// REAL fileNameOf parser from saf.js is exercised. The folder contents are
// switched per-test via `mockFolderFiles`.
const SAVED_FOLDER =
  'content://com.android.externalstorage.documents/tree/primary%3ASyncthing%2FTracker'
const mockFolderFiles = new Map() // display name → file content
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
      ensureAppDir: async () => {},
      appWriteFile: async () => {},
      appListDir: async () => [],
      appDelete: async () => {}
    })
  }
})

function sampleRaw() {
  return JSON.stringify({
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'dark', weekStartsOn: 1, fatigueIncrement: 0.1, fatigueCap: 3.0 },
    difficulties: [],
    categories: [],
    markers: [],
    board: [],
    tasks: [],
    history: []
  })
}

async function flushMicrotasks(times = 12) {
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

describe('app boot pipeline (full tree render)', () => {
  // mounted trees are unmounted after each test: a restored folder arms the
  // 15 s external-change poll interval, which would otherwise outlive the
  // test as an open handle.
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
  })

  test('first run mounts all the way to the setup screen without throwing', async () => {
    let tree = null
    await act(async () => {
      tree = TestRenderer.create(<App />)
      await Promise.resolve()
    })
    await flushMicrotasks()
    mountedTrees.push(tree)

    expect(tree).toBeTruthy()

    const texts = collectTexts(tree.toJSON()).join(' | ')
    // fresh install → SetupScreen fresh-mode headline
    expect(texts).toContain('Welcome to Habit Tracker')
    // and it must still be mounted (not an error screen)
    expect(texts).not.toContain('No safe area value available')
  })

  // The remote-reported eternal-'Loading…' regression, end to end.
  //
  // A saved folder is restored at boot; the SAF read RESOLVES (perfectly
  // healthy device — this is NOT a stall test). The store transitioned
  // 'loading' → 'missing'/'ready' underneath, but the UI never re-rendered:
  // notify() used to mutate the state object in place, so
  // useSyncExternalStore's checkIfSnapshotChanged (Object.is on the
  // reference) dropped every notification and the tree stayed on the aurora
  // 'Loading…' screen FOREVER — the exact user report "i cannot go past the
  // loading", across app restarts, on every build up to and including 1.0.3.
  describe('saved folder restored at boot (eternal-loading regression)', () => {
    beforeEach(async () => {
      await AsyncStorage.clear()
      await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
    })

    test('restored folder without habit.json reaches the setup screen', async () => {
      let tree = null
      await act(async () => {
        tree = TestRenderer.create(<App />)
        await Promise.resolve()
      })
      await flushMicrotasks()
      mountedTrees.push(tree)

      const texts = collectTexts(tree.toJSON()).join(' | ')
      // With the in-place-mutation store this stayed 'Loading…' forever.
      expect(texts).not.toContain('Loading…')
      expect(texts).toContain('No habit.json in this folder')
      // the build marker makes any future screenshot self-identifying
      expect(texts).toMatch(/v\d+\.\d+/)
    })

    test('restored folder WITH habit.json reaches the board', async () => {
      mockFolderFiles.set('habit.json', sampleRaw())
      let tree = null
      await act(async () => {
        tree = TestRenderer.create(<App />)
        await Promise.resolve()
      })
      await flushMicrotasks()
      mountedTrees.push(tree)

      const texts = collectTexts(tree.toJSON()).join(' | ')
      // THE happy path that never worked on a real device: the successful
      // 'ready' transition used to be invisible to React, so the app sat on
      // 'Loading…' even though the file had loaded perfectly.
      expect(texts).not.toContain('Loading…')
      expect(texts).toContain('Board')
      expect(texts).toContain('Settings')
    })
  })
})
