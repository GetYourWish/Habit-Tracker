// Store safety tests — the remote-reported Android failures end to end.
//
// REGRESSIONS THIS GUARDS:
//
//  1. 'Not able to find the habit.json file' — on a real device,
//     StorageAccessFramework.readDirectoryAsync returns child URIs whose
//     last segment is the percent-encoded DOCUMENT ID
//     ('primary:Folder/habit.json'), not the file name. The adapter here
//     builds EXACTLY those URI shapes and uses the REAL fileNameOf from
//     saf.js, so a regression in the parser fails these tests at store
//     level (the plain store.test.js adapter uses toy URIs and can't).
//
//  2. 'Create default habit.json just keeps showing loading' — a stalled
//     document-provider WRITE used to hang initializeDefault()/mutate()
//     forever (the load() watchdog only covered reads, and only repainted
//     state — the promises never settled). Every adapter op here races the
//     REAL withTimeout from saf.js at a tiny deadline, exactly like the
//     production adapter: a stalled write must REJECT (so the setup screen
//     can clear its spinner), leave the on-disk file untouched, and release
//     the store's busy flag.
//
//  3. 'Give it a new folder → loading forever' — a stalled folder READ on
//     the restored folder used to freeze the boot splash (booted never
//     flipped) and the folder-picker flow. A timed-out setFolder must
//     RESOLVE into the actionable re-grant state. (The App-level boot
//     companion lives in boot-unblock.test.js.)

const { createTrackerStore } = require('../src/storage/store.js')
const { fileNameOf, withTimeout } = require('../src/storage/saf.js')

// ---------------------------------------------------------------------------
// realistic in-memory adapter: child URIs shaped like a real Android
// external-storage document provider, all ops racing a 25 ms deadline
// ---------------------------------------------------------------------------

const DIR = 'content://com.android.externalstorage.documents/tree/primary%3ASync%2FTracker'
const OP_MS = 25

function docUri(name) {
  return DIR + '/document/' + encodeURIComponent('primary:Sync/Tracker/' + name)
}

function createRealisticAdapter(stallOps = []) {
  const files = new Map() // doc uri → { content, mtime }
  const appFiles = new Map() // app-private backup files
  let clock = 0

  const base = {
    async listChildren() {
      if (stallOps.includes('listChildren')) return new Promise(() => {}) // OEM stall
      return [...files.keys()]
    },
    async createDocument(dirUri, name) {
      if (stallOps.includes('createDocument')) return new Promise(() => {}) // OEM stall
      const uri = docUri(name)
      files.set(uri, { content: '', mtime: ++clock })
      return uri
    },
    async removeDocument(uri) {
      files.delete(uri)
    },
    async readDocument(uri) {
      const f = files.get(uri)
      if (!f) throw new Error('Document not found: ' + uri)
      return f.content
    },
    async writeDocument(uri, content) {
      const f = files.get(uri)
      if (!f) throw new Error('Document not found: ' + uri)
      f.content = content
      f.mtime = ++clock
    },
    async statDocument(uri) {
      const f = files.get(uri)
      return f ? { exists: true, size: f.content.length, modificationTime: f.mtime } : null
    },
    fileNameOf, // the REAL parser — this is the point of these tests
    appDocumentsDir() {
      return 'file://data/user/0/pt/docs/'
    },
    async ensureAppDir() {},
    async appWriteFile(uri, content) {
      appFiles.set(uri, content)
    },
    async appListDir() {
      return [...appFiles.keys()]
    },
    async appDelete(uri) {
      appFiles.delete(uri)
    }
  }

  // production parity: every async provider call races a deadline
  let listCalls = 0
  const guarded = {}
  for (const op of ['listChildren', 'createDocument', 'removeDocument', 'readDocument', 'writeDocument', 'statDocument']) {
    const fn = base[op]
    guarded[op] = (...args) => {
      if (op === 'listChildren') listCalls++
      return withTimeout(() => fn(...args), op, OP_MS)
    }
  }
  return { ...base, ...guarded, _files: files, _appFiles: appFiles, _listCalls: () => listCalls }
}

function sampleRaw() {
  return JSON.stringify(
    {
      schemaVersion: 1,
      meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      settings: { theme: 'dark', weekStartsOn: 1, fatigueIncrement: 0.1, fatigueCap: 3.0 },
      difficulties: [
        { id: 'd-easy', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
        { id: 'd-hard', label: 'Hard', score: 3, color: '#f87171', order: 2, active: true }
      ],
      categories: [],
      markers: [],
      board: [{ type: 'task', taskId: 't1' }],
      tasks: [
        {
          id: 't1',
          text: 'existing task from the desktop',
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-09-01T10:00:00.000Z',
          completion: null
        }
      ],
      workingOn: [],
      logs: []
    },
    null,
    2
  )
}

// ---------------------------------------------------------------------------
// 1. finding habit.json through real document URIs
// ---------------------------------------------------------------------------

describe('store vs real Android document URIs', () => {
  test('loads a habit.json whose child URI ends in the document id, not the name', async () => {
    const adapter = createRealisticAdapter()
    adapter._files.set(docUri('habit.json'), { content: sampleRaw(), mtime: 1 })
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready') // old fileNameOf made this 'missing'
    expect(snap.data.tasks).toHaveLength(1)
    expect(snap.data.tasks[0].text).toBe('existing task from the desktop')
  })

  test('flags Syncthing conflict copies by name through real document URIs', async () => {
    const adapter = createRealisticAdapter()
    const conflictName = 'habit-sync-conflict-20260917-120000-X7Y8Z9.json'
    adapter._files.set(docUri('habit.json'), { content: sampleRaw(), mtime: 1 })
    adapter._files.set(docUri(conflictName), { content: sampleRaw(), mtime: 2 })
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.load()
    expect(store.getSnapshot().conflicts).toEqual([conflictName])
  })

  test('findChildByName semantics inside listFolder: tmp + target with real ids', async () => {
    const adapter = createRealisticAdapter()
    adapter._files.set(docUri('.habit.tmp.json'), { content: 'stale', mtime: 1 })
    adapter._files.set(docUri('habit.json'), { content: sampleRaw(), mtime: 2 })
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.load()
    expect(store.getSnapshot().status).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// 2. initializeDefault safety
// ---------------------------------------------------------------------------

describe('initializeDefault safety', () => {
  test('writes INTO an existing habit.json (no duplicate document) and backs it up first', async () => {
    const adapter = createRealisticAdapter()
    const raw = sampleRaw()
    adapter._files.set(docUri('habit.json'), { content: raw, mtime: 1 })
    const store = createTrackerStore({ adapter, dirUri: DIR })

    // file appeared while the user sat on the 'missing' screen (sync
    // finished mid-flight) — create-default must not clobber it silently
    await store.initializeDefault()

    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')

    // exactly ONE tracker document, now holding the default data
    const docs = [...adapter._files.keys()].map(fileNameOf)
    expect(docs.filter(n => n === 'habit.json')).toHaveLength(1)
    expect(docs.filter(n => n !== 'habit.json' && n !== '.habit.tmp.json')).toHaveLength(0)
    const written = JSON.parse(adapter._files.get(docUri('habit.json')).content)
    expect(written.schemaVersion).toBe(1)
    expect(written.habits.length).toBeGreaterThan(0)

    // no tmp litter
    expect(docs.includes('.habit.tmp.json')).toBe(false)

    // the previous content was backed up verbatim in the app-private area
    const backups = [...adapter._appFiles.entries()]
    expect(backups).toHaveLength(1)
    expect(backups[0][1]).toBe(raw)
  })

  test('cleans its own stale mobile tmp but never deletes the desktop\'s habit.json.tmp', async () => {
    // Two tmp files can legitimately sit in the Syncthing folder:
    //  - '.habit.tmp.json' — OURS (a crashed mobile write); the next write
    //    must remove it before creating a fresh one
    //  - 'habit.json.tmp'  — the DESKTOP app's atomicSave temp, synced in
    //    while the desktop is mid-save. The phone must leave it ALONE:
    //    deleting it would break the desktop's rename. (Our tmp name was
    //    chosen to end in '.json' precisely because Android's
    //    DocumentsContract would otherwise append '.json' to a
    //    'habit.json.tmp' display name, making it unfindable for cleanup.)
    const adapter = createRealisticAdapter()
    adapter._files.set(docUri('.habit.tmp.json'), { content: 'stale mobile write', mtime: 1 })
    adapter._files.set(docUri('habit.json.tmp'), { content: 'desktop mid-save', mtime: 2 })
    const store = createTrackerStore({ adapter, dirUri: DIR })

    await store.initializeDefault()

    const docs = [...adapter._files.keys()].map(fileNameOf)
    // our stale tmp was replaced by the write's own tmp and removed again
    expect(docs.includes('.habit.tmp.json')).toBe(false)
    // the desktop's live tmp survived untouched
    expect(docs.includes('habit.json.tmp')).toBe(true)
    expect(adapter._files.get(docUri('habit.json.tmp')).content).toBe('desktop mid-save')
    // and the target landed under its real name
    expect(docs.includes('habit.json')).toBe(true)
  })

  test('createDocument is called with the tmp name that ends in .json (Android never re-suffixed it)', async () => {
    // Guard for the OTHER half of the createFileAsync regression: the tmp
    // display name must end with '.json', or Android's DocumentsContract
    // appends the MIME extension ('habit.json.tmp' → 'habit.json.tmp.json')
    // and the exact-name cleanup in writeData stops finding it.
    const created = []
    const adapter = createRealisticAdapter()
    const baseCreate = adapter.createDocument.bind(adapter)
    adapter.createDocument = (dirUri, name, mime) => {
      created.push(name)
      return baseCreate(dirUri, name, mime)
    }
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.initializeDefault()
    expect(created.length).toBeGreaterThan(0)
    for (const name of created) {
      expect(name.endsWith('.json')).toBe(true)
    }
  })

  test('rejects with SAF_TIMEOUT when the provider write stalls — no infinite spinner', async () => {
    const adapter = createRealisticAdapter(['createDocument'])
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.load()
    expect(store.getSnapshot().status).toBe('missing')

    await expect(store.initializeDefault()).rejects.toMatchObject({ code: 'SAF_TIMEOUT' })

    // the store stays actionable: not 'ready', busy released (a subsequent
    // poll must actually list the folder again)
    expect(store.getSnapshot().status).toBe('missing')
    const before = adapter._listCalls()
    await store.checkExternal(true)
    expect(adapter._listCalls()).toBeGreaterThan(before)
  })

  test('a stalled mutate rejects and leaves the on-disk file untouched', async () => {
    const adapter = createRealisticAdapter(['createDocument'])
    const raw = sampleRaw()
    adapter._files.set(docUri('habit.json'), { content: raw, mtime: 1 })
    const store = createTrackerStore({ adapter, dirUri: DIR })
    await store.load()
    expect(store.getSnapshot().status).toBe('ready')

    await expect(
      store.mutate(base => ({ ...base, tasks: [...base.tasks, { id: 't2', text: 'nope' }] }))
    ).rejects.toMatchObject({ code: 'SAF_TIMEOUT' })

    // the original bytes survived the failed write pipeline
    expect(adapter._files.get(docUri('habit.json')).content).toBe(raw)
    const busyBlocked = await store.checkExternal(true)
    expect(busyBlocked).toBe(true) // busy flag released — the poll ran a full load
  })
})

// ---------------------------------------------------------------------------
// 3. stalled folder reads must resolve, not hang the caller
// ---------------------------------------------------------------------------

describe('stalled folder reads', () => {
  test('setFolder RESOLVES to the re-grant state when listing stalls (old code hung forever)', async () => {
    const adapter = createRealisticAdapter(['listChildren'])
    const store = createTrackerStore({ adapter, dirUri: null })

    await store.setFolder(DIR) // must settle within the op deadline, not hang

    const snap = store.getSnapshot()
    expect(snap.status).toBe('no-folder')
    expect(snap.errorMessage).toBeTruthy()
  })
})
