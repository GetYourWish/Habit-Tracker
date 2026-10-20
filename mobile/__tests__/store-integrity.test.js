// Store integrity regressions for the 2026-10 sync hardening:
//  - CONTENT-TRUTH POLL: checkExternal detects an external rewrite even
//    when the document's stat (size + modificationTime) does not change —
//    SAF providers report coarse timestamps and same-size rewrites are
//    routine (e.g. toggling a check-in), so a stat-only poll misses real
//    changes (SYNC-DESIGN: "the hash is the truth").
//  - TWO-STRIKE no-folder rule: one transient provider failure must not
//    bounce a ready board to the re-grant screen; the second consecutive
//    failure may.
//  - NOT_READY mutation guards: from 'missing'/'error' states a mutation
//    must never fall through to createDefaultData() and overwrite a damaged
//    or absent folder with starter data.
//  - CANONICAL-NAME REDIRECT: when the loader adopted a conflict-named copy
//    as its read target (no habit.json in the folder), a mutation must
//    write to a real habit.json document — never into the conflict copy,
//    which Syncthing never syncs back (silent cross-device divergence).

const {
  createTrackerStore,
  setCorruptSettleForTests
} = require('../src/storage/store.js')
const {
  createHabit,
  toggleHabitCompletion
} = require('../src/actions.js')

// Instant corrupt-settle in tests (production keeps the 3×700ms window).
beforeAll(() => setCorruptSettleForTests({ attempts: 0, delayMs: 0 }))
afterAll(() => setCorruptSettleForTests({ attempts: 3, delayMs: 700 }))

// --- in-memory adapter (same contract as store.test.js) ----------------------

function fileNameOf(uri) {
  return uri.substring(uri.lastIndexOf('/') + 1)
}

function createMemoryAdapter(initialFiles = {}) {
  const files = new Map() // uri → { content, mtime }
  const dirs = new Map() // dirUri → Set(child uri)

  function registerDir(dirUri) {
    if (!dirs.has(dirUri)) dirs.set(dirUri, new Set())
    return dirs.get(dirUri)
  }

  function putFile(uri, content) {
    files.set(uri, { content, mtime: ++mtimeCounter })
    const parent = uri.substring(0, uri.lastIndexOf('/'))
    if (parent) registerDir(parent).add(uri)
  }

  let mtimeCounter = 0
  for (const [uri, content] of Object.entries(initialFiles)) putFile(uri, content)

  return {
    async listChildren(dirUri) {
      const set = dirs.get(dirUri)
      if (!set) throw new Error('SecurityException: no access to ' + dirUri)
      return [...set].filter(u => files.has(u) || dirs.has(u))
    },
    async findChildByName(dirUri, name) {
      const children = await this.listChildren(dirUri)
      return children.find(u => fileNameOf(u) === name) || null
    },
    async createDocument(dirUri, name) {
      const uri = dirUri.replace(/\/$/, '') + '/' + name
      if (!dirs.has(dirUri)) throw new Error('SecurityException: no access to ' + dirUri)
      putFile(uri, '')
      return uri
    },
    async removeDocument(uri) {
      files.delete(uri)
      for (const set of dirs.values()) set.delete(uri)
    },
    async readDocument(uri) {
      const entry = files.get(uri)
      if (!entry) throw new Error('Document not found: ' + uri)
      return entry.content
    },
    async writeDocument(uri, content) {
      const entry = files.get(uri)
      if (!entry) throw new Error('Document not found: ' + uri)
      entry.content = content
      entry.mtime = ++mtimeCounter
      entry.size = content.length
    },
    async statDocument(uri) {
      const entry = files.get(uri)
      if (!entry) return null
      return { exists: true, size: entry.content.length, modificationTime: entry.mtime }
    },
    fileNameOf,
    appDocumentsDir() {
      return 'app://docs/'
    },
    async ensureAppDir() {},
    async appWriteFile(uri, content) {
      putFile(uri, content)
    },
    async appListDir(dirUri) {
      return [...(dirs.get(dirUri) || [])].filter(u => files.has(u))
    },
    async appDelete(uri) {
      files.delete(uri)
    },
    _files: files,
    _dirs: dirs
  }
}

const DIR = 'content://com.android.externalstorage.documents/tree/Syncthing/'
const FILE = 'habit.json'

function sampleData() {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1 },
    frequencies: [
      { id: 'f-daily', key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, color: '#34d399', icon: '☀️' }
    ],
    habits: [
      { id: 'h1', title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: 'f-daily', archived: false }
    ],
    board: [{ type: 'habit', habitId: 'h1' }],
    completions: [],
    categories: []
  }
}

async function createReadyStore(adapter, initialData) {
  adapter._files.set(DIR + FILE, {
    content: JSON.stringify(initialData, null, 2),
    mtime: 1
  })
  adapter._dirs.set(DIR, new Set([DIR + FILE]))
  const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
  await store.load()
  return store
}

// ---------------------------------------------------------------------------
// CONTENT-TRUTH POLL
// ---------------------------------------------------------------------------

describe('checkExternal — content is the truth', () => {
  test('detects a rewrite whose size and mtime did not change (stat lies)', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    const before = store.getSnapshot().data

    // External rewrite: same SIZE (swap the habit title for one of equal
    // length) and forced-identical mtime — the exact class of change a
    // stat-only poll misses on providers with coarse timestamps.
    const external = JSON.parse(JSON.stringify(before))
    external.habits[0].title = 'Floss teeth' // same 11 chars as 'Brush teeth'
    const entry = adapter._files.get(DIR + FILE)
    const frozenMtime = entry.mtime
    entry.content = JSON.stringify(external, null, 2)
    entry.mtime = frozenMtime

    const changed = await store.checkExternal()
    expect(changed).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.data.habits[0].title).toBe('Floss teeth')
  })

  test('identical content does not repaint (no-change-no-write for the poll)', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    const genBefore = store.getSnapshot().data
    const changed = await store.checkExternal()
    expect(changed).toBe(false)
    expect(store.getSnapshot().data).toBe(genBefore) // same reference: no repaint
  })

  test('a schema-refused file is re-evaluated only when its content changes', async () => {
    const newer = { ...sampleData(), schemaVersion: 2 }
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + FILE, { content: JSON.stringify(newer, null, 2), mtime: 1 })
    adapter._dirs.set(DIR, new Set([DIR + FILE]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().status).toBe('schema-too-new')

    // unchanged refused file → poll sees identical bytes, no reload
    expect(await store.checkExternal()).toBe(false)
    expect(store.getSnapshot().status).toBe('schema-too-new')

    // the desktop replaces it with a compatible file → poll reloads it
    adapter._files.set(DIR + FILE, { content: JSON.stringify(sampleData(), null, 2), mtime: 2 })
    expect(await store.checkExternal()).toBe(true)
    expect(store.getSnapshot().status).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// TWO-STRIKE no-folder rule
// ---------------------------------------------------------------------------

describe('checkExternal — transient provider failures', () => {
  test('a single failed read keeps the ready board; the second consecutive failure surfaces no-folder', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    const originalRead = adapter.readDocument.bind(adapter)

    let fail = 0
    adapter.readDocument = async uri => {
      if (fail > 0) throw new Error('provider hiccup')
      return originalRead(uri)
    }

    fail = 1
    expect(await store.checkExternal()).toBe(false)
    expect(store.getSnapshot().status).toBe('ready') // still usable

    // a successful poll in between resets the strike counter
    fail = 0
    expect(await store.checkExternal()).toBe(false)
    expect(store.getSnapshot().status).toBe('ready')

    // two CONSECUTIVE failures → re-grant screen
    fail = 1
    expect(await store.checkExternal()).toBe(false)
    expect(store.getSnapshot().status).toBe('ready')
    expect(await store.checkExternal()).toBe(false)
    expect(store.getSnapshot().status).toBe('no-folder')
  })
})

// ---------------------------------------------------------------------------
// NOT_READY mutation guards
// ---------------------------------------------------------------------------

describe('mutations from non-ready states', () => {
  test('missing: a mutation is refused and never creates a starter file', async () => {
    const adapter = createMemoryAdapter()
    adapter._dirs.set(DIR, new Set())
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().status).toBe('missing')

    await expect(
      store.mutate((d, now) => toggleHabitCompletion(d, { habitId: 'h1', date: '2026-10-20', slot: 'morning' }, now))
    ).rejects.toMatchObject({ code: 'NOT_READY' })
    expect(adapter._files.size).toBe(0) // nothing was written
  })

  test('corrupt: a mutation is refused, never falls back to createDefaultData', async () => {
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + FILE, { content: '{ "schemaVersion": 1, "habits": [BROKEN', mtime: 1 })
    adapter._dirs.set(DIR, new Set([DIR + FILE]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().recovery).toBeTruthy()

    // the corrupt settle window is real time in production but tests run it
    // instantly via the exported seam? No — settle uses wall-clock delay;
    // the corrupt state here is entered through load() which settles with
    // the configured attempts. The mutation must be refused regardless.
    await expect(
      store.mutate((d, now) => toggleHabitCompletion(d, { habitId: 'h1', date: '2026-10-20' }, now))
    ).rejects.toMatchObject({ code: 'NOT_READY' })
    // the damaged bytes were preserved, never overwritten
    expect(adapter._files.get(DIR + FILE).content).toBe('{ "schemaVersion": 1, "habits": [BROKEN')
  })
})

// ---------------------------------------------------------------------------
// CANONICAL-NAME REDIRECT (cross-device sync)
// ---------------------------------------------------------------------------

describe('writeData never persists into a conflict-named document', () => {
  test('a mutation from a conflict-copy read target lands in a NEW habit.json', async () => {
    const conflictName = 'habit-sync-conflict-20261019-120000-ABCDEF.json'
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + conflictName, { content: JSON.stringify(sampleData(), null, 2), mtime: 1 })
    adapter._dirs.set(DIR, new Set([DIR + conflictName]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()

    // the load fell back to the conflict copy so the user sees their data
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().conflicts).toContain(conflictName)

    await store.mutate((d, now) => createHabit(d, { title: 'from phone', frequencyId: 'f-daily' }, now))

    const names = [...adapter._files.keys()].map(fileNameOf)
    // the write went to a canonical habit.json…
    expect(names).toContain(FILE)
    const written = JSON.parse(adapter._files.get(DIR + FILE).content)
    expect(written.habits.some(h => h.title === 'from phone')).toBe(true)
    // …and the conflict copy was NOT touched (no mutation inside it)
    const conflictData = JSON.parse(adapter._files.get(DIR + conflictName).content)
    expect(conflictData.habits.some(h => h.title === 'from phone')).toBe(false)
  })

  test('a habit.json that appears mid-flight is adopted, not duplicated', async () => {
    const conflictName = 'habit-sync-conflict-20261019-120000-ABCDEF.json'
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + conflictName, { content: JSON.stringify(sampleData(), null, 2), mtime: 1 })
    adapter._dirs.set(DIR, new Set([DIR + conflictName]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()

    // Syncthing delivers the real habit.json BETWEEN the load and the write
    const delivered = sampleData()
    delivered.habits[0].title = 'Delivered by desktop'
    adapter._files.set(DIR + FILE, { content: JSON.stringify(delivered, null, 2), mtime: 5 })
    adapter._dirs.get(DIR).add(DIR + FILE)

    await store.mutate((d, now) => createHabit(d, { title: 'from phone', frequencyId: 'f-daily' }, now))

    const written = JSON.parse(adapter._files.get(DIR + FILE).content)
    // rebase preserved the delivered content AND applied the phone mutation
    expect(written.habits.some(h => h.title === 'Delivered by desktop')).toBe(true)
    expect(written.habits.some(h => h.title === 'from phone')).toBe(true)
    // no misnamed sibling documents were left behind
    const names = [...adapter._files.keys()].map(fileNameOf)
    expect(names.filter(n => n.includes('(')).length).toBe(0)
  })
})
