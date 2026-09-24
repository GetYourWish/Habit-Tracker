// Store repair tests (the 2026-09-21 'every action corrupts the file'
// incident).
//
// Remote-reported symptoms: changing the theme or adding a task ended on
//   "Could not load habit.json / Corrupt JSON: JSON Parse error:
//    Unexpected character: }"
// every single time; "Restore latest backup" worked, and the next action
// corrupted the file again. Evidence timeline (device screenshot): the
// pre-write backup rotated at 19:00:26.474 and the corrupt state painted at
// 19:00:26.854 — the damage was produced by the write cycle itself.
//
// Root cause: some Android document providers do not truncate an EXISTING
// document opened via openOutputStream(uri, "w") — a shorter write leaves
// the previous content's tail bytes behind. habit.json is pretty-printed
// JSON whose last byte is '}', so a 1–2 byte shrink (theme 'system' →
// 'dark') leaves a stray '}' after the complete new document: exactly the
// reported parse error. The tmp sibling always verified because it is
// created FRESH every cycle (no old bytes to leave behind).
//
// These tests pin the JS half of the fix:
//  1. PROVIDER-QUIRK REPAIR — when the in-place target write fails byte
//     verification, the target is recreated as a fresh document inside the
//     same cycle (the write that just succeeded for the fresh tmp).
//  2. TRANSIENT-DAMAGE SETTLE — a read landing while Syncthing pulls blocks
//     into the file heals after a settle delay: loads and even in-flight
//     mutations recover instead of entering the corrupt state.
//  3. PERSISTENT corruption still enters the recovery state — and the
//     byte-verified tmp sibling is now actually OFFERED (the recovery
//     source discovery re-lists the folder; the cached listing predated
//     the tmp the failing cycle had just created).
//  4. SAF dedupe guard — a same-named document that refuses to go away can
//     never redirect writes into a misnamed 'tracker (1).json' sibling.

const {
  createTrackerStore,
  setCorruptSettleForTests
} = require('../src/storage/store.js')
const { createTask, updateSettings } = require('../src/actions.js')

// Settle retries are instant in here — the retry COUNT is what matters.
setCorruptSettleForTests({ attempts: 2, delayMs: 0 })

// ---------------------------------------------------------------------------
// quirk adapter — in-memory FsAdapter with provider-defect simulation
// ---------------------------------------------------------------------------

function fileNameOf(uri) {
  return uri.substring(uri.lastIndexOf('/') + 1)
}

// dir URIs arrive with a trailing slash, child URIs derive parents without
// one — normalize every directory key so listings survive remove+create
function dirKey(dirUri) {
  return dirUri.replace(/\/$/, '')
}

function createQuirkAdapter(initialFiles = {}, quirks = {}) {
  const files = new Map() // uri → { content, mtime, size }
  const dirs = new Map() // dirUri → Set(child uri)
  const ops = [] // every adapter call, for repair-path assertions
  // quirks:
  //  nonTruncating: Set<uri> — writes shorter than the current content keep
  //                  the old tail bytes (the defect that caused the incident)
  //  garbageUris:   Set<uri> — every write lands with trailing garbage
  //  undeletable:   Set<uri> — removeDocument throws (caught by the store)
  //  dedupeOnCreate: boolean — createDocument with an existing name makes
  //                  'name (1).json' (SAF collision behavior)
  //  readOverrides: Map<uri, string[]> — queued one-shot read responses
  //                  (transient mid-sync observations)

  function registerDir(dirUri) {
    const key = dirKey(dirUri)
    if (!dirs.has(key)) dirs.set(key, new Set())
    return dirs.get(key)
  }

  function putFile(uri, content) {
    files.set(uri, { content, mtime: ++mtimeCounter })
    const parent = uri.substring(0, uri.lastIndexOf('/'))
    if (parent) registerDir(parent).add(uri)
  }

  let mtimeCounter = 0
  for (const [uri, content] of Object.entries(initialFiles)) putFile(uri, content)

  const adapter = {
    async listChildren(dirUri) {
      ops.push(['list', dirUri])
      const set = dirs.get(dirKey(dirUri))
      if (!set) throw new Error('SecurityException: no access to ' + dirUri)
      return [...set].filter(u => files.has(u))
    },
    async findChildByName(dirUri, name) {
      const children = await this.listChildren(dirUri)
      return children.find(u => fileNameOf(u) === name) || null
    },
    async createDocument(dirUri, name) {
      ops.push(['create', name])
      const parent = dirKey(dirUri)
      let finalName = name
      if (quirks.dedupeOnCreate && files.has(parent + '/' + name)) {
        finalName = name.replace(/(\.[^.]+)$/, ' (1)$1')
      }
      const uri = parent + '/' + finalName
      if (!dirs.has(parent)) throw new Error('SecurityException: no access to ' + dirUri)
      putFile(uri, '')
      return uri
    },
    async removeDocument(uri) {
      ops.push(['remove', fileNameOf(uri)])
      if (quirks.undeletable && quirks.undeletable.has(uri)) {
        throw new Error('SecurityException: cannot delete ' + uri)
      }
      files.delete(uri)
      for (const set of dirs.values()) set.delete(uri)
    },
    async readDocument(uri) {
      const queued = quirks.readOverrides && quirks.readOverrides.get(uri)
      if (queued && queued.length > 0) {
        const raw = queued.shift()
        ops.push(['read-override', fileNameOf(uri)])
        return raw
      }
      ops.push(['read', fileNameOf(uri)])
      const entry = files.get(uri)
      if (!entry) throw new Error('Document not found: ' + uri)
      return entry.content
    },
    async writeDocument(uri, content) {
      ops.push(['write', fileNameOf(uri)])
      const entry = files.get(uri)
      if (!entry) throw new Error('Document not found: ' + uri)
      if (quirks.garbageUris && quirks.garbageUris.has(uri)) {
        entry.content = content + 'GARBAGE'
      } else if (
        quirks.nonTruncating &&
        quirks.nonTruncating.has(uri) &&
        content.length < entry.content.length
      ) {
        // the provider did NOT truncate: old bytes survive past the write
        entry.content = content + entry.content.slice(content.length)
      } else {
        entry.content = content
      }
      entry.mtime = ++mtimeCounter
      entry.size = entry.content.length
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
    _dirs: dirs,
    _ops: ops
  }
  return adapter
}

const DIR = 'content://com.android.externalstorage.documents/tree/Syncthing/'
const FILE = 'habit.json'
const TARGET = DIR + FILE
const TMP = DIR + '.tracker.tmp.json'

function sampleData() {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { theme: 'system', weekStartsOn: 1, fatigueIncrement: 0.10, fatigueCap: 3.0 },
    difficulties: [
      { id: 'd-easy', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
      { id: 'd-hard', label: 'Hard', score: 3, color: '#f87171', order: 2, active: true }
    ],
    categories: [{ id: 'c-1', name: 'Work', color: '#60a5fa', order: 0, active: true, priorityMultiplier: 2 }],
    markers: [],
    board: [],
    tasks: [],
    workingOn: [],
    logs: []
  }
}

async function createReadyStore(adapter, initialData) {
  adapter._files.set(TARGET, { content: JSON.stringify(initialData, null, 2), mtime: 1 })
  adapter._dirs.set(dirKey(DIR), new Set([TARGET]))
  const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
  await store.load()
  return store
}

function folderNames(adapter) {
  return [...adapter._dirs.get(dirKey(DIR))].map(u => fileNameOf(u)).sort()
}

// ---------------------------------------------------------------------------
// 1) provider-quirk repair
// ---------------------------------------------------------------------------

describe('non-truncating provider (the every-action-corrupts incident)', () => {
  test('a SHORTER theme write is repaired in-cycle — mutate resolves, file is valid', async () => {
    const adapter = createQuirkAdapter({}, { nonTruncating: new Set([TARGET]) })
    const store = await createReadyStore(adapter, sampleData())

    // 'system' → 'dark' shrinks the pretty JSON by 2 bytes — the exact
    // incident shape: complete new JSON + the old document's final '}'.
    await store.mutate((d, now) => updateSettings(d, { theme: 'dark' }, now))

    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.data.settings.theme).toBe('dark')

    // the file on disk parses and holds the saved content
    const raw = adapter._files.get(TARGET).content
    const parsed = JSON.parse(raw) // must not throw — this is the regression
    expect(parsed.settings.theme).toBe('dark')

    // the repair recreated the target (remove + create + write), and the
    // verified tmp sibling was cleaned up afterwards
    const removes = adapter._ops.filter(([op, name]) => op === 'remove' && name === FILE)
    const creates = adapter._ops.filter(([op, name]) => op === 'create' && name === FILE)
    expect(removes.length).toBeGreaterThanOrEqual(1)
    expect(creates.length).toBeGreaterThanOrEqual(1)
    expect(folderNames(adapter)).toEqual([FILE]) // no tmp, no 'tracker (1).json'
  })

  test('a LONGER task-add write needs no repair and still lands correctly', async () => {
    const adapter = createQuirkAdapter({}, { nonTruncating: new Set([TARGET]) })
    const store = await createReadyStore(adapter, sampleData())

    await store.mutate((d, now) => createTask(d, 'Ship the fix', now))

    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.data.tasks).toHaveLength(1)

    const parsed = JSON.parse(adapter._files.get(TARGET).content)
    expect(parsed.tasks).toHaveLength(1)

    // growing writes never hit the tail defect → the target was never recreated
    const creates = adapter._ops.filter(([op, name]) => op === 'create' && name === FILE)
    expect(creates).toHaveLength(0)
    expect(folderNames(adapter)).toEqual([FILE])
  })

  test('rapid theme taps on the quirky provider all land in one valid file', async () => {
    const adapter = createQuirkAdapter({}, { nonTruncating: new Set([TARGET]) })
    const store = await createReadyStore(adapter, sampleData())

    await Promise.all([
      store.mutate((d, now) => updateSettings(d, { theme: 'dark' }, now)),
      store.mutate((d, now) => updateSettings(d, { theme: 'light' }, now)),
      store.mutate((d, now) => updateSettings(d, { theme: 'system' }, now))
    ])

    const parsed = JSON.parse(adapter._files.get(TARGET).content)
    expect(['dark', 'light', 'system']).toContain(parsed.settings.theme)
    expect(store.getSnapshot().status).toBe('ready')
    expect(folderNames(adapter)).toEqual([FILE])
  })
})

// ---------------------------------------------------------------------------
// 2) transient (mid-sync) damage heals instead of declaring corruption
// ---------------------------------------------------------------------------

describe('transient mid-sync reads settle before the corrupt state', () => {
  test('a load that catches Syncthing mid-pull recovers to ready', async () => {
    const data = sampleData()
    const raw = JSON.stringify(data, null, 2)
    // first read observes garbage (blocks still landing); the settle re-read
    // sees the finished file
    const adapter = createQuirkAdapter(
      {},
      { readOverrides: new Map([[TARGET, [raw.slice(0, Math.floor(raw.length * 0.4)) + '"x']]]) }
    )
    adapter._files.set(TARGET, { content: raw, mtime: 1 })
    adapter._dirs.set(dirKey(DIR), new Set([TARGET]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })

    await store.load()

    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready') // not 'error'
    expect(snap.data.settings.theme).toBe('system')
  })

  test('a mutation whose rebase catches a mid-sync file proceeds on the healed content', async () => {
    const readOverrides = new Map() // populated after the initial load
    const adapter = createQuirkAdapter({}, { readOverrides })
    const store = await createReadyStore(adapter, sampleData())

    // external edit landed (theme flipped by the desktop + synced in), but
    // the rebase's first read observes the file mid-sync — the settle
    // re-read sees the finished file and the mutation proceeds on top of it
    const external = JSON.stringify(
      { ...sampleData(), settings: { ...sampleData().settings, theme: 'light' } },
      null,
      2
    )
    adapter._files.get(TARGET).content = external
    adapter._files.get(TARGET).mtime = 99
    adapter._files.get(TARGET).size = external.length
    readOverrides.set(TARGET, [external.slice(0, 200) + '"garbage'])

    await store.mutate((d, now) => updateSettings(d, { theme: 'dark' }, now))

    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.data.settings.theme).toBe('dark')

    const parsed = JSON.parse(adapter._files.get(TARGET).content)
    expect(parsed.settings.theme).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
// 3) persistent corruption still surfaces — with the tmp recovery source
// ---------------------------------------------------------------------------

describe('persistent damage still enters recovery — and offers the verified tmp', () => {
  test('a provider that mangles EVERY target write rejects with CORRUPT_FILE', async () => {
    const adapter = createQuirkAdapter({}, { garbageUris: new Set([TARGET]) })
    const store = await createReadyStore(adapter, sampleData())

    await expect(
      store.mutate((d, now) => updateSettings(d, { theme: 'dark' }, now))
    ).rejects.toMatchObject({ code: 'CORRUPT_FILE' })

    const snap = store.getSnapshot()
    expect(snap.status).toBe('error')
    expect(snap.errorMessage).toMatch(/Corrupt JSON/)

    // the byte-verified tmp from the failing cycle is in the folder AND is
    // offered as a recovery source (the stale-listing bug hid it before)
    expect(folderNames(adapter)).toContain('.tracker.tmp.json')
    expect(snap.recovery.sources.tmp).toBe('.tracker.tmp.json')
  })
})

// ---------------------------------------------------------------------------
// 4) SAF dedupe guard
// ---------------------------------------------------------------------------

describe('SAF name-collision guard', () => {
  test('an undeletable target never redirects writes into tracker (1).json', async () => {
    const adapter = createQuirkAdapter(
      {},
      {
        nonTruncating: new Set([TARGET]),
        undeletable: new Set([TARGET]),
        dedupeOnCreate: true
      }
    )
    const store = await createReadyStore(adapter, sampleData())

    // the repair tries remove (fails silently) + create (dedupes) → the
    // store must notice the misnamed document and remove it. The in-place
    // write already damaged the target, so the cycle honestly ends on the
    // corrupt-file recovery route — the pinned invariant is the FOLDER
    // state: no 'tracker (1).json' sibling, original document still there,
    // recovery sources available.
    await expect(
      store.mutate((d, now) => updateSettings(d, { theme: 'dark' }, now))
    ).rejects.toMatchObject({ code: 'CORRUPT_FILE' })

    const names = folderNames(adapter)
    expect(names).not.toContain('tracker (1).json') // the dupe was cleaned up
    expect(names).toContain(FILE) // the original document is still there
    expect(names).toContain('.tracker.tmp.json') // verified recovery copy kept
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().recovery.sources.tmp).toBe('.tracker.tmp.json')
  })
})
