// Storage layer + action tests, run under Node (jest, testEnvironment node).
// The SAF adapter is swapped for an in-memory one — the store never imports
// expo, so the full write pipeline (rebase, no-change-no-write, atomic tmp
// write, backups) is testable here without a device.

const {
  createTrackerStore
} = require('../src/storage/store.js')
const {
  backupFileName,
  selectOldBackups,
  isBackupName
} = require('../src/storage/backups.js')
const {
  createHabit,
  updateHabit,
  setHabitArchived,
  deleteHabit,
  toggleHabitCompletion,
  createCategory,
  updateSettings,
  frequencyFor
} = require('../src/actions.js')

// ---------------------------------------------------------------------------
// in-memory FsAdapter
// ---------------------------------------------------------------------------

function fileNameOf(uri) {
  return uri.substring(uri.lastIndexOf('/') + 1)
}

function createMemoryAdapter(initialFiles = {}) {
  const files = new Map() // uri → { content, mtime, size }
  const dirs = new Map() // dirUri → Set(child uri)

  function registerDir(dirUri) {
    if (!dirs.has(dirUri)) dirs.set(dirUri, new Set())
    return dirs.get(dirUri)
  }

  function putFile(uri, content) {
    files.set(uri, { content, mtime: ++mtimeCounter })
    // auto-register in the parent dir
    const idx = uri.lastIndexOf('/', uri.length - 2) // handle trailing slash roots
    const parent = uri.substring(0, uri.lastIndexOf('/'))
    if (parent) registerDir(parent).add(uri)
  }

  let mtimeCounter = 0
  for (const [uri, content] of Object.entries(initialFiles)) putFile(uri, content)

  return {
    // SAF surface
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
    // internal (app-private) surface
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
    // test introspection
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
// backups helpers
// ---------------------------------------------------------------------------

describe('backups rotation', () => {
  test('backupFileName matches desktop scheme', () => {
    expect(backupFileName('2026-08-28T10:20:30.123Z')).toBe('habit-2026-08-28T10-20-30-123Z.json')
  })

  test('selectOldBackups keeps the newest 20', () => {
    const names = []
    for (let i = 1; i <= 25; i++) {
      const ts = String(i).padStart(3, '0')
      names.push(`habit-2026-01-${ts}T00-00-00-000Z.json`)
    }
    const old = selectOldBackups(names)
    expect(old).toHaveLength(5)
    expect(old[0]).toContain('-001')
    expect(selectOldBackups(names.slice(0, 20))).toHaveLength(0)
  })

  test('isBackupName ignores other files', () => {
    expect(isBackupName('habit-2026-01-01T00-00-00-000Z.json')).toBe(true)
    expect(isBackupName('habit.json')).toBe(false)
    expect(isBackupName('habit.json.tmp')).toBe(false) // desktop atomicSave tmp
    expect(isBackupName('.habit.tmp.json')).toBe(false) // mobile atomic-write tmp
  })
})

// ---------------------------------------------------------------------------
// actions (pure transforms, desktop parity — habit model)
// ---------------------------------------------------------------------------

describe('actions', () => {
  const DAILY = 'f-daily'

  function habitData() {
    return {
      ...sampleData(),
      habits: [],
      completions: [],
      frequencies: [{ id: DAILY, key: 'daily', label: 'Every day', kind: 'daily', timesPerPeriod: 1, timesPerDay: 1 }]
    }
  }

  test('createHabit appends the habit + board row (desktop HabitEditor)', () => {
    const next = createHabit(habitData(), {
      title: 'Brush teeth', icon: '🪥', color: '#34d399', frequencyId: DAILY, timesPerDay: 2, timesOfDay: ['morning', 'evening']
    }, '2026-02-01T10:00:00.000Z')
    expect(next.habits).toHaveLength(1)
    const h = next.habits[0]
    expect(h.title).toBe('Brush teeth')
    expect(h.timesPerDay).toBe(2)
    expect(h.timesOfDay).toEqual(['morning', 'evening'])
    expect(h.archived).toBe(false)
    expect(next.board).toEqual([{ type: 'habit', habitId: h.id }])
    expect(next.meta.updatedAt).toBe('2026-02-01T10:00:00.000Z')
  })

  test('createHabit omits per-day fields when they are default/absent', () => {
    const next = createHabit(habitData(), { title: 'Walk', frequencyId: DAILY }, '2026-02-01T10:00:00.000Z')
    const h = next.habits[0]
    expect(h.timesPerDay).toBeUndefined()
    expect(h.timesOfDay).toBeUndefined()
  })

  test('updateHabit merges fields; null per-day fields reset to the cadence default', () => {
    const d = createHabit(habitData(), {
      title: 'Water', frequencyId: DAILY, timesPerDay: 3, timesOfDay: ['morning', 'afternoon', 'evening']
    }, '2026-02-01T10:00:00.000Z')
    const id = d.habits[0].id
    const edited = updateHabit(d, id, { title: 'Hydrate', timesPerDay: null, timesOfDay: null }, '2026-02-01T10:01:00.000Z')
    const h = edited.habits[0]
    expect(h.title).toBe('Hydrate')
    expect(h.timesPerDay).toBeUndefined()
    expect(h.timesOfDay).toBeUndefined()
    expect(h.id).toBe(id)
  })

  test('toggleHabitCompletion adds then undoes a slot check-in (desktop TodayView)', () => {
    let d = createHabit(habitData(), {
      title: 'Brush', frequencyId: DAILY, timesPerDay: 2, timesOfDay: ['morning', 'evening']
    }, '2026-02-01T10:00:00.000Z')
    const id = d.habits[0].id

    const on = toggleHabitCompletion(d, { habitId: id, date: '2026-02-01', slot: 'morning' }, '2026-02-01T08:00:00.000Z')
    expect(on.completions).toHaveLength(1)
    expect(on.completions[0].slot).toBe('morning')

    // same slot again → undo removes it
    const off = toggleHabitCompletion(on, { habitId: id, date: '2026-02-01', slot: 'morning' }, '2026-02-01T08:01:00.000Z')
    expect(off.completions).toHaveLength(0)
  })

  test('toggleHabitCompletion anytime flow fills one at a time, then unwinds', () => {
    let d = createHabit(habitData(), { title: 'Stretch', frequencyId: DAILY, timesPerDay: 3 }, '2026-02-01T10:00:00.000Z')
    const id = d.habits[0].id

    d = toggleHabitCompletion(d, { habitId: id, date: '2026-02-01', slot: null, count: 3 }, '2026-02-01T10:01:00.000Z')
    d = toggleHabitCompletion(d, { habitId: id, date: '2026-02-01', slot: null, count: 3 }, '2026-02-01T10:02:00.000Z')
    expect(d.completions).toHaveLength(2)
    // 4th tap on a full 3-count row removes the latest again
    d = toggleHabitCompletion(d, { habitId: id, date: '2026-02-01', slot: null, count: 2 }, '2026-02-01T10:03:00.000Z')
    expect(d.completions).toHaveLength(1)
    // other dates never interfere
    d = toggleHabitCompletion(d, { habitId: id, date: '2026-01-31', slot: null, count: 3 }, '2026-02-01T10:04:00.000Z')
    expect(d.completions.filter(c => c.date === '2026-01-31')).toHaveLength(1)
  })

  test('setHabitArchived / deleteHabit match desktop behavior', () => {
    let d = createHabit(habitData(), { title: 'Read', frequencyId: DAILY }, '2026-02-01T10:00:00.000Z')
    const id = d.habits[0].id
    d = toggleHabitCompletion(d, { habitId: id, date: '2026-02-01', slot: null, count: 1 }, '2026-02-01T10:01:00.000Z')

    const archived = setHabitArchived(d, id, true, '2026-02-01T10:02:00.000Z')
    expect(archived.habits[0].archived).toBe(true)

    const deleted = deleteHabit(archived, id, '2026-02-01T10:03:00.000Z')
    expect(deleted.habits).toHaveLength(0)
    expect(deleted.board).toHaveLength(0)
    expect(deleted.completions).toHaveLength(0) // history goes with it
  })

  test('updateSettings merges keys and bumps meta (desktop handleSettingChange)', () => {
    const base = habitData()
    const next = updateSettings(base, { theme: 'dark' }, '2026-02-01T10:00:00.000Z')
    expect(next.settings.theme).toBe('dark')
    expect(next.meta.updatedAt).toBe('2026-02-01T10:00:00.000Z')
  })

  test('frequencyFor resolves by id and falls back to daily for broken refs', () => {
    const d = habitData()
    const fixed = { id: 'h1', frequencyId: DAILY }
    const broken = { id: 'h2', frequencyId: 'no-such' }
    expect(frequencyFor(d, fixed).key).toBe('daily')
    expect(frequencyFor(d, broken).key).toBe('daily')
    expect(frequencyFor({ ...d, frequencies: [] }, broken)).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// store pipeline
// ---------------------------------------------------------------------------

describe('tracker store', () => {
  test('missing file → status missing, nothing written', async () => {
    const adapter = createMemoryAdapter()
    adapter._dirs.set(DIR, new Set()) // picked folder, no children
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().status).toBe('missing')
    expect(adapter._files.size).toBe(0)
  })

  test('schemaVersion > 1 is refused and left untouched', async () => {
    const newer = { ...sampleData(), schemaVersion: 2 }
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + FILE, { content: JSON.stringify(newer, null, 2), mtime: 1 })
    adapter._dirs.set(DIR, new Set([DIR + FILE]))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.status).toBe('schema-too-new')
    expect(snap.schemaVersion).toBe(2)
    // file content unchanged
    expect(adapter._files.get(DIR + FILE).content).toBe(JSON.stringify(newer, null, 2))
  })

  test('loads and heals, then no-change-no-write on identical mutation', async () => {
    const base = sampleData()
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, base)
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().data.settings.theme).toBe('system')

    const before = adapter._files.get(DIR + FILE)
    // a mutation that changes nothing (same data object content)
    const result = await store.mutate(d => ({ ...d }))
    expect(result.skipped).toBe(true)
    expect(adapter._files.get(DIR + FILE).mtime).toBe(before.mtime)
  })

  test('mutate writes pretty JSON, removes the tmp document', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    await store.mutate(d => createHabit(d, { title: 'hello', frequencyId: 'f-daily' }, '2026-02-01T10:00:00.000Z'))

    const names = [...adapter._files.keys()].map(fileNameOf)
    // the mobile tmp is a leading-dot name (Android-safe, desktop-distinct)
    expect(names).not.toContain('.habit.tmp.json')
    expect(names).not.toContain('habit.json.tmp')
    const raw = adapter._files.get(DIR + FILE).content
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2)) // pretty, 2-space
    const parsed = JSON.parse(raw)
    expect(parsed.habits[0].title).toBe('hello')
    expect(parsed.board[0].habitId).toBe(parsed.habits[0].id)
  })

  test('REBASE: external change between load and mutate is preserved', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())

    // desktop writes a new task while the phone holds a stale base
    const desktopData = sampleData()
    desktopData.habits = desktopData.habits || []
    desktopData.habits.push({ id: 'desktop-habit', title: 'from desktop', icon: '⭐', color: '#34d399', frequencyId: 'f-daily', archived: false, order: 0, createdAt: '2026-02-01T09:00:00.000Z' })
    desktopData.board.push({ type: 'habit', habitId: 'desktop-habit' })
    desktopData.meta.updatedAt = '2026-02-01T09:00:00.000Z'
    adapter._files.set(DIR + FILE, { content: JSON.stringify(desktopData, null, 2), mtime: 99 })

    // phone completes ITS task — mutation must land on top of the fresh base
    const result = await store.mutate(d => {
      // d is the REBASED base: it must contain the desktop habit
      expect(d.habits.some(t => t.id === 'desktop-habit')).toBe(true)
      return createHabit(d, { title: 'from phone', frequencyId: 'f-daily' }, '2026-02-01T10:00:00.000Z')
    })

    const raw = JSON.parse(adapter._files.get(DIR + FILE).content)
    const titles = raw.habits.map(t => t.title)
    expect(titles).toContain('from desktop')
    expect(titles).toContain('from phone')
    expect(result.skipped).toBe(false)
  })

  test('REBASE: overwriting an external change rotates a backup first', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())

    const external = sampleData()
    external.meta.updatedAt = '2026-02-01T08:00:00.000Z'
    const externalRaw = JSON.stringify(external, null, 2)
    adapter._files.set(DIR + FILE, { content: externalRaw, mtime: 77 })

    await store.mutate(d => updateSettings(d, { theme: 'dark' }, '2026-02-01T10:00:00.000Z'))

    const backupDir = 'app://docs/.backups/'
    const backups = [...adapter._files.keys()].filter(u => u.startsWith(backupDir))
    expect(backups).toHaveLength(1)
    expect(adapter._files.get(backups[0]).content).toBe(externalRaw)
  })

  test('REBASE: a newly corrupted file opens recovery and is never overwritten by a settings/task mutation', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    const corrupt = '{"schemaVersion":1,"tasks":[}'
    adapter._files.set(DIR + FILE, { content: corrupt, mtime: 88 })

    await expect(
      store.mutate(d => createHabit(d, { title: 'must not be written', frequencyId: 'f-daily' }, '2026-02-01T10:00:00.000Z'))
    ).rejects.toMatchObject({ code: 'CORRUPT_FILE' })

    expect(adapter._files.get(DIR + FILE).content).toBe(corrupt)
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().data).toBeNull()
    expect(store.getSnapshot().recovery.canSalvage).toBe(true)
    expect([...adapter._files.values()].some(file => file.content === corrupt)).toBe(true)
  })

  test('REBASE: newer schemaVersion during rebase aborts the mutation', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())

    const future = { ...sampleData(), schemaVersion: 3 }
    adapter._files.set(DIR + FILE, { content: JSON.stringify(future, null, 2), mtime: 55 })

    await expect(
      store.mutate(d => createHabit(d, { title: 'should not land', frequencyId: 'f-daily' }, '2026-02-01T10:00:00.000Z'))
    ).rejects.toMatchObject({ code: 'SCHEMA_VERSION_TOO_NEW', schemaVersion: 3 })

    expect(store.getSnapshot().status).toBe('schema-too-new')
    // the future file is untouched — never downgraded
    expect(adapter._files.get(DIR + FILE).content).toBe(JSON.stringify(future, null, 2))
  })

  test('checkExternal reloads when the file changes on disk', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())

    // identical stat → no reload (polling no-op)
    const dataRef = store.getSnapshot().data
    const changed = await store.checkExternal()
    expect(changed).toBe(false)
    expect(store.getSnapshot().data).toBe(dataRef)

    // external write → new stat → reload
    const desktopData = sampleData()
    desktopData.tasks.push({ id: 'x', text: 'external', createdAt: '2026-02-01T09:00:00.000Z', completion: null })
    adapter._files.set(DIR + FILE, { content: JSON.stringify(desktopData, null, 2), mtime: 4242 })
    const changed2 = await store.checkExternal()
    expect(changed2).toBe(true)
    expect(store.getSnapshot().data.tasks).toHaveLength(1)
  })

  test('conflict files are surfaced but never loaded or deleted', async () => {
    const adapter = createMemoryAdapter()
    adapter._files.set(DIR + FILE, { content: JSON.stringify(sampleData(), null, 2), mtime: 1 })
    adapter._files.set(DIR + 'tracker.sync-conflict-20260201-100000.json', { content: '{}', mtime: 2 })
    adapter._dirs.set(DIR, new Set([DIR + FILE, DIR + 'tracker.sync-conflict-20260201-100000.json']))
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().conflicts).toEqual(['tracker.sync-conflict-20260201-100000.json'])
    expect(adapter._files.has(DIR + 'tracker.sync-conflict-20260201-100000.json')).toBe(true)
  })

  test('backupNow copies current content; rotation keeps 20', async () => {
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    await store.backupNow()
    const backupDir = 'app://docs/.backups/'
    expect([...adapter._files.keys()].filter(u => u.startsWith(backupDir))).toHaveLength(1)

    // flood past the window
    for (let i = 0; i < 22; i++) {
      await store.backupNow()
    }
    const backups = [...adapter._files.keys()].filter(u => u.startsWith(backupDir))
    expect(backups.length).toBeLessThanOrEqual(20)
  })

  test('initializeDefault creates the default data file', async () => {
    const adapter = createMemoryAdapter()
    adapter._dirs.set(DIR, new Set()) // picked folder, no children
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    await store.load()
    expect(store.getSnapshot().status).toBe('missing')
    await store.initializeDefault()
    expect(store.getSnapshot().status).toBe('ready')
    const parsed = JSON.parse(adapter._files.get(DIR + FILE).content)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.habits.length).toBeGreaterThan(0)
    expect(parsed.frequencies.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// load watchdog: a SAF read that never settles must not spin 'loading' forever
// ---------------------------------------------------------------------------

describe('load watchdog (stalled SAF reads)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  function makeStalledAdapter() {
    const adapter = createMemoryAdapter()
    adapter._dirs.set(DIR, new Set())
    let resolveListing = null
    adapter.listChildren = () =>
      new Promise(resolve => {
        resolveListing = resolve
      })
    // test handle to let the stalled read eventually settle
    adapter._releaseListing = children => resolveListing(children)
    return adapter
  }

  test('a load that never settles becomes a recoverable no-folder state', async () => {
    jest.useFakeTimers()
    const adapter = makeStalledAdapter()
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    const pending = store.load() // never resolves — that is the point
    pending.catch(() => {}) // no unhandled-rejection noise
    await jest.advanceTimersByTimeAsync(15000)
    const snap = store.getSnapshot()
    expect(snap.status).toBe('no-folder')
    expect(snap.errorMessage).toMatch(/timed out/i)
    expect(snap.errorMessage).toMatch(/Re-grant folder access/)
  })

  test('a load that settles normally is untouched by the watchdog', async () => {
    jest.useFakeTimers()
    const adapter = createMemoryAdapter()
    const store = await createReadyStore(adapter, sampleData())
    await jest.advanceTimersByTimeAsync(60000)
    expect(store.getSnapshot().status).toBe('ready')
  })

  test('a late success after the watchdog fired still wins (no newer load started)', async () => {
    jest.useFakeTimers()
    const adapter = makeStalledAdapter()
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    const pending = store.load()
    await jest.advanceTimersByTimeAsync(15000)
    expect(store.getSnapshot().status).toBe('no-folder')
    adapter._dirs.set(DIR, new Set([DIR + FILE]))
    adapter._files.set(DIR + FILE, { content: JSON.stringify(sampleData(), null, 2), mtime: 1 })
    adapter._releaseListing([DIR + FILE])
    await jest.advanceTimersByTimeAsync(0) // flush microtasks
    expect(store.getSnapshot().status).toBe('ready')
    await pending.catch(() => {})
  })

  test('a newer load supersedes a stalled older one (generation guard)', async () => {
    jest.useFakeTimers()
    const adapter = makeStalledAdapter()
    const store = createTrackerStore({ adapter, dirUri: DIR, fileName: FILE })
    const stalled = store.load() // load #1 — stalls
    await jest.advanceTimersByTimeAsync(15000)
    expect(store.getSnapshot().status).toBe('no-folder')

    // user taps "Retry loading" — the retry uses a working adapter
    adapter.listChildren = async () => [DIR + FILE]
    adapter._files.set(DIR + FILE, { content: JSON.stringify(sampleData(), null, 2), mtime: 1 })
    await store.load() // load #2 — completes
    expect(store.getSnapshot().status).toBe('ready')

    // NOW the stalled load #1 finally settles — it must not repaint state
    adapter._dirs.set(DIR, new Set([DIR + FILE]))
    adapter._releaseListing([DIR + FILE])
    await jest.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().status).toBe('ready')
    await stalled.catch(() => {})
  })
})
