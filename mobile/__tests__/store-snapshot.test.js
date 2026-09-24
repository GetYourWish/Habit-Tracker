// Snapshot contract tests — guard the remote-reported 'stuck on Loading…
// forever, even after a successful load' failure.
//
// REGRESSION THIS GUARDS:
//
//   React's useSyncExternalStore ONLY re-renders a component when
//   getSnapshot() returns a NEW reference. Its checkIfSnapshotChanged()
//   (verified in the React 19.2 renderer bundled with RN 0.87) compares the
//   previous and next snapshot with Object.is and silently DROPS the store
//   notification when the reference is unchanged:
//
//     function checkIfSnapshotChanged(inst) {
//       var latestGetSnapshot = inst.getSnapshot;
//       inst = inst.value;
//       var nextValue = latestGetSnapshot();
//       return !objectIs(inst, nextValue);   // same object ⇒ false ⇒ no render
//     }
//
//   The store used to mutate its state object in place
//   (Object.assign(state, next)), so getSnapshot() ALWAYS returned the same
//   reference: every transition after the first paint — 'loading' → 'ready'
//   after a fully successful load, the 15 s watchdog recovery, folder picks,
//   everything — was INVISIBLE to React. The app froze on the aurora
//   'Loading…' screen forever while the store underneath had long recovered.
//   The UI only ever repainted when an unrelated useState (booted / busy /
//   tab) happened to change in the same component, which is why this looked
//   exactly like a storage hang.
//
//   These tests replicate React's exact visibility rule against a REAL store:
//   a transition only "happened" if the snapshot reference changed.

const { createTrackerStore } = require('../src/storage/store.js')
const { fileNameOf } = require('../src/storage/saf.js')

const DIR = 'content://com.android.externalstorage.documents/tree/primary%3ASync%2FTracker'

function docUri(name) {
  return DIR + '/document/' + encodeURIComponent('primary:Sync/Tracker/' + name)
}

function createAdapter() {
  const files = new Map()
  return {
    async listChildren() {
      return [...files.keys()]
    },
    async createDocument(dirUri, name) {
      const uri = docUri(name)
      files.set(uri, '')
      return uri
    },
    async removeDocument(uri) {
      files.delete(uri)
    },
    async readDocument(uri) {
      const c = files.get(uri)
      if (c === undefined) throw new Error('Document not found: ' + uri)
      return c
    },
    async writeDocument(uri, content) {
      files.set(uri, content)
    },
    async statDocument(uri) {
      const c = files.get(uri)
      return c === undefined ? null : { exists: true, size: c.length, modificationTime: 1 }
    },
    fileNameOf,
    appDocumentsDir() {
      return 'file://data/user/0/pt/docs/'
    },
    async ensureAppDir() {},
    async appWriteFile() {},
    async appListDir() {
      return []
    },
    async appDelete() {}
  }
}

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

// React's exact visibility rule: a listener only "sees" a transition when the
// snapshot reference changed (Object.is). This is a faithful copy of
// checkIfSnapshotChanged + the useSyncExternalStore subscribe callback.
function watchWithReactSemantics(store) {
  const seenStatuses = []
  const seenRefs = []
  let latest = store.getSnapshot()
  const unsubscribe = store.subscribe(() => {
    const next = store.getSnapshot()
    if (!Object.is(latest, next)) {
      // React would call forceStoreRerender here — the transition is visible
      latest = next
      seenStatuses.push(next.status)
      seenRefs.push(next)
    }
    // same reference ⇒ React bails out: the transition is INVISIBLE
  })
  return { seenStatuses, seenRefs, unsubscribe }
}

describe('store snapshot contract (useSyncExternalStore visibility)', () => {
  test('every transition publishes a NEW snapshot reference (React can see it)', async () => {
    const adapter = createAdapter()
    const store = createTrackerStore({ adapter, dirUri: DIR })
    const watch = watchWithReactSemantics(store)

    expect(store.getSnapshot().status).toBe('loading')

    await store.load() // resolves: folder empty → 'missing'

    // Without the immutable-notify fix, seenStatuses stays EMPTY: React
    // would never have re-rendered and the UI would still show 'Loading…'.
    // (load() republishes 'loading' with a fresh reference before resolving
    // to 'missing' — both transitions must be visible.)
    expect(watch.seenStatuses).toEqual(['loading', 'missing'])
    watch.unsubscribe()
  })

  test('successful load → ready is visible to React (the eternal-loading regression)', async () => {
    const adapter = createAdapter()
    // Syncthing already delivered the desktop's habit.json
    await adapter.writeDocument(await adapter.createDocument(null, 'habit.json'), sampleRaw())
    const store = createTrackerStore({ adapter, dirUri: DIR })
    const watch = watchWithReactSemantics(store)

    await store.load()

    // THE user-facing regression: with the in-place mutation, this was
    // ['loading'] only — 'ready' was invisible and the app sat on the
    // 'Loading…' screen forever even though the file loaded perfectly.
    expect(watch.seenStatuses).toEqual(['loading', 'ready'])
    expect(store.getSnapshot().status).toBe('ready')
    watch.unsubscribe()
  })

  test('getSnapshot is referentially STABLE between notifications (no render loop)', () => {
    const store = createTrackerStore({ adapter: createAdapter(), dirUri: null })

    // React calls getSnapshot repeatedly between notifications (mount-time
    // double-call, render-time reads). A new object per CALL would loop
    // React forever; the store must cache until notify().
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    const c = store.getSnapshot()
    expect(a).toBe(b)
    expect(b).toBe(c)

    const watch = watchWithReactSemantics(store)
    return store.setFolder(DIR).then(() => {
      expect(store.getSnapshot()).not.toBe(a) // changed after a notify
      expect(watch.seenStatuses.length).toBeGreaterThan(0)
      watch.unsubscribe()
    })
  })

  test('watchdog recovery is visible: stalled read → actionable re-grant state', async () => {
    jest.useFakeTimers()
    try {
      const adapter = createAdapter()
      adapter.listChildren = () => new Promise(() => {}) // OEM provider stall
      const store = createTrackerStore({ adapter, dirUri: DIR })
      const watch = watchWithReactSemantics(store)

      // not awaited: the provider never settles (that is the stall); the
      // promise simply stays pending — no timers remain once the watchdog
      // has fired, so nothing keeps the jest worker alive.
      store.load()
      // settle microtasks so the load reaches the stalled listChildren
      await Promise.resolve()
      await Promise.resolve()
      jest.advanceTimersByTime(15000) // LOAD_TIMEOUT_MS

      // The watchdog repaint MUST be visible to React — with the old
      // mutation it never was, so a stalled device stayed on 'Loading…'
      // forever with the recovery screen hidden underneath.
      expect(watch.seenStatuses).toContain('no-folder')
      expect(store.getSnapshot().errorMessage).toBeTruthy()
      watch.unsubscribe()
    } finally {
      jest.useRealTimers()
    }
  })

  test('published snapshots are never mutated after the fact', async () => {
    const adapter = createAdapter()
    await adapter.writeDocument(await adapter.createDocument(null, 'habit.json'), sampleRaw())
    const store = createTrackerStore({ adapter, dirUri: DIR })

    const before = store.getSnapshot()
    await store.load()
    const after = store.getSnapshot()

    // The snapshot React rendered with must not change underneath it —
    // 'before' still shows what was true when it was published.
    expect(before.status).toBe('loading')
    expect(after.status).toBe('ready')
    expect(before).not.toBe(after)
  })
})
