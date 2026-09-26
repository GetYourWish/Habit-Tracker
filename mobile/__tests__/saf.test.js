// SAF adapter tests — the pure parts of the ONLY module that talks to
// Android's document provider.
//
// REGRESSION THIS GUARDS (remote-reported: 'stuck on the main page, not able
// to find the habit.json file'):
//
//   StorageAccessFramework.readDirectoryAsync returns child URIs whose last
//   segment is the percent-encoded DOCUMENT ID
//   ('primary:Folder/habit.json'), not the file name. The old fileNameOf
//   decoded that segment and compared it against 'habit.json' — never a
//   match on a real device, so a habit.json synced in via Syncthing was
//   unfindable and the app sat on the 'No habit.json' screen forever.
//   The unit suite never caught it because the in-memory adapter builds
//   child URIs whose last segment genuinely is the file name.
//
// Also guards the SAF op timeout: a stalled document-provider call (known
// OEM behavior once a persisted folder permission goes stale) used to hang
// every awaiting screen (boot splash, 'Create default habit.json', the
// folder picker) forever — the load() watchdog only repainted STATE, the
// promises themselves never settled.
//
// And the createFileAsync argument order: the adapter used to pass
// (dirUri, mime, name) while expo's REAL signature is
// createFileAsync(parentUri, fileName, mimeType) — every created document
// got the display name 'application/json' instead of 'habit.json', so
// 'Create default habit.json' produced a file the app could never find
// again. The mock below now mirrors expo's REAL parameter order; a mock
// must mirror the LIBRARY, never the code under test.

// Stand-in for 'expo-file-system/legacy' so the adapter is exercisable in
// Node. The factory reads mockLegacyState at CALL time so a test can flip a
// provider into 'stalled' mode; every call is recorded for arg assertions.
const mockLegacyState = { stallReadDirectory: false }
const mockLegacyCalls = []

function mockMakeLegacyFs(state) {
  return {
    EncodingType: { UTF8: 'utf8' },
    documentDirectory: 'file://data/user/0/pt/docs/',
    // BASE readDirectoryAsync (file:// dirs — used by the app-private
    // .backups/.corrupt windows). The NATIVE implementation returns BARE
    // FILE NAMES (`children.map { it?.name }` in FileSystemLegacyModule.kt) —
    // mockLegacyState.baseDirNames reproduces that device behavior.
    readDirectoryAsync: async dirUri => {
      mockLegacyCalls.push(['base.readDirectoryAsync', dirUri])
      return state.baseDirNames || []
    },
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: async () => ({
        granted: true,
        directoryUri: 'content://picked/tree'
      }),
      readDirectoryAsync: async dirUri => {
        mockLegacyCalls.push(['readDirectoryAsync', dirUri])
        if (state.stallReadDirectory) return new Promise(() => {}) // OEM stall: never settles
        return []
      },
      createFileAsync: async (parentUri, fileName, mimeType) => {
        mockLegacyCalls.push(['createFileAsync', parentUri, fileName, mimeType])
        return parentUri + '/' + encodeURIComponent(fileName)
      }
    },
    readAsStringAsync: async (uri, opts) => {
      mockLegacyCalls.push(['readAsStringAsync', uri, opts])
      return '{}'
    },
    writeAsStringAsync: async (uri, content, opts) => {
      mockLegacyCalls.push(['writeAsStringAsync', uri, content, opts])
    },
    deleteAsync: async (uri, opts) => {
      mockLegacyCalls.push(['deleteAsync', uri, opts])
    },
    getInfoAsync: async uri => {
      mockLegacyCalls.push(['getInfoAsync', uri])
      return { exists: true, size: 2, modificationTime: 5 }
    },
    makeDirectoryAsync: async () => {}
  }
}

jest.mock('expo-file-system/legacy', () => mockMakeLegacyFs(mockLegacyState), { virtual: true })

const {
  fileNameOf,
  withTimeout,
  SAF_OP_TIMEOUT_MS,
  createSafAdapter,
  requestFolder
} = require('../src/storage/saf.js')

// ---------------------------------------------------------------------------
// fileNameOf — real Android document-provider URI shapes
// ---------------------------------------------------------------------------

const EXT = 'content://com.android.externalstorage.documents'

describe('fileNameOf with real SAF document URIs', () => {
  test('external-storage child: document id is the full path, name is its last segment', () => {
    const uri =
      EXT + '/tree/primary%3ASyncthing%2FTracker/document/primary%3ASyncthing%2FTracker%2Fhabit.json'
    expect(fileNameOf(uri)).toBe('habit.json')
  })

  test('deeply nested external-storage child', () => {
    const uri =
      EXT +
      '/tree/primary%3Adata%2Fsync/document/primary%3Adata%2Fsync%2Fdevices%2Fphone%2Fhabit.json'
    expect(fileNameOf(uri)).toBe('habit.json')
  })

  test('Syncthing conflict copy keeps its full name (conflict detection depends on it)', () => {
    const name = 'habit-sync-conflict-20260917-120000-X7Y8Z9.json'
    const uri =
      EXT +
      '/tree/primary%3ASyncthing%2FTracker/document/primary%3ASyncthing%2FTracker%2F' +
      encodeURIComponent(name)
    expect(fileNameOf(uri)).toBe(name)
  })

  test('temp document from the atomic-write pipeline', () => {
    const uri = EXT + '/tree/primary%3AFolder/document/primary%3AFolder%2Fhabit.json.tmp'
    expect(fileNameOf(uri)).toBe('habit.json.tmp')
  })

  test('names with spaces and percent signs survive decoding', () => {
    expect(
      fileNameOf(EXT + '/tree/primary%3AFolder/document/primary%3AFolder%2Fmy%20habit.json')
    ).toBe('my habit.json')
    expect(
      fileNameOf(EXT + '/tree/primary%3AFolder/document/primary%3AFolder%2F100%25done.json')
    ).toBe('100%done.json')
  })

  test('raw:/storage/... document ids (older providers)', () => {
    const uri =
      'content://com.android.providers.downloads.documents/tree/downloads/document/' +
      encodeURIComponent('raw:/storage/emulated/0/Download/habit.json')
    expect(fileNameOf(uri)).toBe('habit.json')
  })

  test('unencoded hand-built document URIs (expo getUriForDirectoryInRoot style)', () => {
    expect(fileNameOf(EXT + '/tree/primary:Foo/document/primary:Foo/bar.json')).toBe('bar.json')
  })

  test('plain/simple child URIs (test adapter, simple providers) still work', () => {
    expect(fileNameOf('mem://dir/habit.json')).toBe('habit.json')
    expect(fileNameOf('content://test/tree/x/habit.json')).toBe('habit.json')
    expect(fileNameOf('content://test/tree/x/habit.json.tmp')).toBe('habit.json.tmp')
  })

  test('malformed percent-encoding does not throw and still yields the last segment', () => {
    expect(fileNameOf(EXT + '/tree/primary%3AFolder/document/primary%3AFolder%2F100%.json')).toBe(
      '100%.json'
    )
  })

  test('empty / falsy input', () => {
    expect(fileNameOf('')).toBe('')
    expect(fileNameOf(null)).toBe('')
    expect(fileNameOf(undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// withTimeout — the anti-hang guard for document-provider calls
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  test('passes through resolved values', async () => {
    await expect(withTimeout(() => Promise.resolve(42), 'op', 50)).resolves.toBe(42)
  })

  test('passes through rejections', async () => {
    await expect(withTimeout(() => Promise.reject(new Error('boom')), 'op', 50)).rejects.toThrow(
      'boom'
    )
  })

  test('a stalled op rejects with SAF_TIMEOUT after the deadline', async () => {
    const promise = withTimeout(() => new Promise(() => {}), 'Reading the data folder', 30)
    await expect(promise).rejects.toMatchObject({
      code: 'SAF_TIMEOUT',
      op: 'Reading the data folder'
    })
  })

  test('timeout error carries an actionable message', async () => {
    await expect(
      withTimeout(() => new Promise(() => {}), 'Writing habit.json', 10)
    ).rejects.toThrow(/Writing habit\.json timed out.*Pick the folder again/)
  })

  test('a synchronous throw inside the op rejects (lazy expo require safety)', async () => {
    await expect(
      withTimeout(() => {
        throw new Error('module missing')
      }, 'op', 50)
    ).rejects.toThrow('module missing')
  })

  test('clears the timer once settled (no dangling timers)', async () => {
    jest.useFakeTimers()
    try {
      const p = withTimeout(() => Promise.resolve('ok'), 'op', 1000)
      await expect(p).resolves.toBe('ok')
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// createSafAdapter — every provider call is timeout-guarded, args are correct
// ---------------------------------------------------------------------------

describe('createSafAdapter', () => {
  test('listChildren rejects with SAF_TIMEOUT when the provider stalls', async () => {
    mockLegacyState.stallReadDirectory = true
    const adapter = createSafAdapter()
    jest.useFakeTimers()
    try {
      const promise = adapter.listChildren('content://folder')
      const assertion = expect(promise).rejects.toMatchObject({ code: 'SAF_TIMEOUT' })
      jest.advanceTimersByTime(SAF_OP_TIMEOUT_MS + 100)
      await assertion
    } finally {
      jest.useRealTimers()
      mockLegacyState.stallReadDirectory = false
    }
  })

  test('createDocument calls createFileAsync(parentUri, fileName, mimeType) in that order — the real expo signature', async () => {
    // REGRESSION: the adapter used to pass (dirUri, mime, name) — swapped.
    // On a real device the created document was named after the MIME string
    // ('application/json'), never 'habit.json', so the app could not read
    // back what it had just created ('create default → still cannot read it').
    // The expo ground truth (expo-file-system 57.0.6, src/legacy/FileSystem.ts):
    //   createFileAsync(parentUri: string, fileName: string, mimeType: string)
    mockLegacyCalls.length = 0
    const adapter = createSafAdapter()
    await adapter.createDocument('content://folder', 'habit.json')
    expect(mockLegacyCalls).toEqual([
      ['createFileAsync', 'content://folder', 'habit.json', 'application/json']
    ])
  })

  test('createDocument forwards a custom mime in the third slot', async () => {
    mockLegacyCalls.length = 0
    const adapter = createSafAdapter()
    await adapter.createDocument('content://folder', 'notes.txt', 'text/plain')
    expect(mockLegacyCalls).toEqual([
      ['createFileAsync', 'content://folder', 'notes.txt', 'text/plain']
    ])
  })

  test('readDocument/writeDocument/removeDocument/statDocument hit the legacy fs API', async () => {
    mockLegacyCalls.length = 0
    const adapter = createSafAdapter()
    await adapter.writeDocument('content://folder/habit.json', '{}')
    await adapter.readDocument('content://folder/habit.json')
    await adapter.removeDocument('content://folder/habit.json.tmp')
    const stat = await adapter.statDocument('content://folder/habit.json')
    expect(stat).toEqual({ exists: true, size: 2, modificationTime: 5 })
    const kinds = mockLegacyCalls.map(c => c[0])
    expect(kinds).toEqual(['writeAsStringAsync', 'readAsStringAsync', 'deleteAsync', 'getInfoAsync'])
  })

  test('requestFolder maps the picker result (never timeout-guarded: user-driven)', async () => {
    const res = await requestFolder()
    expect(res).toEqual({ granted: true, directoryUri: 'content://picked/tree' })
  })

  // ---------------------------------------------------------------------------
  // appListDir — DEVICE PARITY (v1.0.7 fix)
  //
  // Android's legacy readDirectoryAsync returns BARE FILE NAMES for file://
  // directories. The store's backup rotation and restore-from-backup treat
  // adapter listings as URIs; before the fix, deleteAsync/readAsStringAsync
  // received a bare name on real devices, parsed it as a scheme-less URI and
  // failed ('Location … isn't deletable') — silently killing backup pruning
  // and the 'Restore latest backup' recovery path. Every Node in-memory
  // adapter returned full URIs, so the whole suite was blind to it.
  // ---------------------------------------------------------------------------

  describe('appListDir device parity', () => {
    const adapter = createSafAdapter()

    test('bare file names (the real device shape) become full URIs', async () => {
      mockLegacyState.baseDirNames = ['habit-backup-2026.json', 'habit-backup-2027.json']
      try {
        const uris = await adapter.appListDir('file://data/user/0/pt/docs/.backups/')
        expect(uris).toEqual([
          'file://data/user/0/pt/docs/.backups/habit-backup-2026.json',
          'file://data/user/0/pt/docs/.backups/habit-backup-2027.json'
        ])
      } finally {
        delete mockLegacyState.baseDirNames
      }
    })

    test('entries that are already URIs pass through untouched', async () => {
      mockLegacyState.baseDirNames = ['file://data/user/0/pt/docs/.backups/x.json']
      try {
        const uris = await adapter.appListDir('file://data/user/0/pt/docs/.backups/')
        expect(uris).toEqual(['file://data/user/0/pt/docs/.backups/x.json'])
      } finally {
        delete mockLegacyState.baseDirNames
      }
    })

    test('a failing read (missing dir on first run) yields an empty list', async () => {
      mockLegacyState.baseDirNames = undefined
      // the mock returns [] by default; emulate a thrown error path instead
      const orig = mockLegacyState.baseDirNames
      const fs = require('expo-file-system/legacy')
      const realRead = fs.readDirectoryAsync
      fs.readDirectoryAsync = async () => {
        throw new Error('ENOENT')
      }
      try {
        await expect(adapter.appListDir('file://data/user/0/pt/docs/.backups/')).resolves.toEqual([])
      } finally {
        fs.readDirectoryAsync = realRead
        mockLegacyState.baseDirNames = orig
      }
    })
  })
})
