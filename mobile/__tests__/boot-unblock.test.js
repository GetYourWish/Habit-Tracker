// Boot unblock test — guards the remote-reported 'stuck on Loading… before
// any board appears' failure at the hook level.
//
// REGRESSION THIS GUARDS:
//
//   useTracker's bootstrap used to `await store.setFolder(savedFolder)`
//   before flipping `booted`. When the restored folder's SAF read stalls
//   (OEM document providers sometimes never settle once a persisted
//   permission goes stale), setFolder's load() promise NEVER resolved —
//   the load() watchdog repainted the store state underneath, but the App
//   still rendered the plain boot splash because `booted` was the FIRST
//   gate in its render chain. Result: endless 'Loading…', no board, no
//   setup screen, no recovery path.
//
//   The fix: boot completes independently of the initial load. The store
//   owns recovery from there — its watchdog turns the stall into the
//   actionable re-grant state.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTracker } from '../src/hooks/useTracker.js'

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

// An adapter whose folder listing NEVER settles — the device stall. Every
// other op is irrelevant here: the boot path only gets as far as the first
// listChildren() call. The pending calls are captured so teardown can
// release them (letting the store's load() settle and clear its 15 s
// watchdog — otherwise the timer lingers as an open handle after the suite).
const stallReleasers = []
const mockHangingAdapter = {
  listChildren: () =>
    new Promise((_, reject) => {
      stallReleasers.push(reject)
    }),
  findChildByName: async () => null,
  createDocument: async () => {
    throw new Error('unused in this test')
  },
  removeDocument: async () => {},
  readDocument: async () => {
    throw new Error('unused in this test')
  },
  writeDocument: async () => {},
  statDocument: async () => null,
  fileNameOf: u => u.substring(u.lastIndexOf('/') + 1),
  appDocumentsDir: () => 'file://docs/',
  ensureAppDir: async () => {},
  appWriteFile: async () => {},
  appListDir: async () => [],
  appDelete: async () => {}
}

jest.mock('../src/storage/saf.js', () => {
  const actual = jest.requireActual('../src/storage/saf.js')
  return { ...actual, createSafAdapter: () => mockHangingAdapter }
})

const SAVED_FOLDER =
  'content://com.android.externalstorage.documents/tree/primary%3ASyncthing%2FTracker'

async function flushMicrotasks(times = 12) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

let mountedTree = null
function mountProbe() {
  const captured = {}
  function Probe() {
    captured.tracker = useTracker()
    return null
  }
  let tree = null
  act(() => {
    tree = TestRenderer.create(<Probe />)
  })
  mountedTree = tree
  return { captured, tree }
}

describe('boot must not block on a stalled restored-folder read', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    await AsyncStorage.setItem('pt.folderUri', SAVED_FOLDER)
  })

  afterEach(async () => {
    // unmount so the 15 s poll interval (armed once folderUri is set)
    // doesn't survive the test as an open handle
    if (mountedTree) {
      act(() => {
        mountedTree.unmount()
      })
      mountedTree = null
    }
    // release the stalled provider calls so load() settles and clears its
    // watchdog timer instead of keeping the process alive for 15 s
    const release = stallReleasers.splice(0)
    release.forEach(r => r(new Error('stall released by test teardown')))
    await flushMicrotasks()
    await AsyncStorage.clear()
  })

  test('booted flips true even while the folder read hangs forever', async () => {
    const { captured, tree } = mountProbe()
    await act(async () => {
      await flushMicrotasks()
    })
    // THE regression: with the old `await store.setFolder(...)` bootstrap
    // this stayed false forever and the app never left the splash screen
    expect(captured.tracker.booted).toBe(true)
    expect(captured.tracker.folderUri).toBe(SAVED_FOLDER)
    expect(captured.tracker.state.status).toBe('loading') // store still trying
    expect(tree).toBeTruthy()
  })

  // The rest of the recovery chain is guarded elsewhere: the load watchdog
  // (stalled read → actionable 'no-folder') in store.test.js, and the
  // timed-out setFolder in store-safety.test.js; the App renders the
  // re-grant SetupScreen for that state.
})
