// Storage Access Framework adapter — the ONLY module in the Android app that
// talks to Android's document provider. Every higher layer (store, screens)
// goes through the FsAdapter interface implemented here, which keeps the
// tracker store fully unit-testable in Node with an in-memory adapter.
//
// Import strategy: expo-file-system moved its string/SAF APIs to
// `expo-file-system/legacy` in SDK 54; older SDKs export them at the root.
// The lazy require keeps this module (and its expo dependency) out of the
// Node test environment.

let _fs = null
function expoFs() {
  if (!_fs) {
    try {
      _fs = require('expo-file-system/legacy') // SDK 54+
    } catch (e) {
      _fs = require('expo-file-system') // older SDKs
    }
  }
  return _fs
}

function SAF() {
  return expoFs().StorageAccessFramework
}

const JSON_MIME = 'application/json'

// How long a single SAF document-provider call may run before we give up on
// it. Normal calls settle in well under a second; some OEM document providers
// occasionally never answer (reads AND writes) once a persisted folder
// permission goes stale. Before this timeout existed, any stalled call left
// the UI spinning forever — the store's load() watchdog only repainted STATE,
// while the awaiting promise (and every screen waiting on it: boot splash,
// "Create default habit.json", folder picker) hung for good.
export const SAF_OP_TIMEOUT_MS = 20000

// Race `op()` against a timer. Losers keep running in the background (SAF
// calls cannot be cancelled) but their result is discarded — the store's
// generation guard already prevents a late resolution from repainting state.
export function withTimeout(op, label, ms = SAF_OP_TIMEOUT_MS) {
  let timer = null
  const bail = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `${label} timed out after ${Math.round(ms / 1000)}s — Android's storage provider stopped responding (happens on some devices when the folder permission goes stale). Pick the folder again.`
      )
      err.code = 'SAF_TIMEOUT'
      err.op = label
      reject(err)
    }, ms)
  })
  const run = Promise.resolve().then(op)
  return Promise.race([run, bail]).finally(() => clearTimeout(timer))
}

// Display name of a SAF document URI.
//
// Real child URIs returned by StorageAccessFramework.readDirectoryAsync look
// like
//   content://com.android.externalstorage.documents/tree/primary%3AFolder
//     /document/primary%3AFolder%2Fhabit.json
// — the segment after '/document/' is the percent-encoded DOCUMENT ID
// ('primary:Folder/habit.json'), NOT the file name. The old implementation
// took the last URI segment and decoded it, producing
// 'primary:Folder/habit.json', which never equals 'habit.json' — so an
// existing habit.json (synced in via Syncthing) could NEVER be found on a
// real device and the app was stuck on the 'No habit.json' screen. (Unit
// tests never caught this: the in-memory adapter builds child URIs whose last
// segment genuinely is the file name.)
//
// Document ids are path-like for the external-storage provider
// ('primary:Folder/habit.json', 'raw:/storage/emulated/0/...'), so the
// display name is the id's LAST path segment. Simple providers (and the
// test adapter) use plain names with no separator at all.
export function fileNameOf(uri) {
  if (!uri) return ''
  const marker = '/document/'
  const idx = uri.indexOf(marker)
  const raw = idx !== -1 ? uri.substring(idx + marker.length) : uri.substring(uri.lastIndexOf('/') + 1)
  // The id's path separators appear URL-encoded ('%2F') in built URIs and
  // literally ('/') in hand-built ones; the display name is the LAST path
  // segment, decoded. Splitting before decoding also keeps a malformed
  // escape (e.g. a lone '%') from swallowing the whole id — worst case the
  // final segment is returned undecoded.
  const parts = raw.split(/%2F|\//i)
  const last = parts[parts.length - 1]
  try {
    return decodeURIComponent(last)
  } catch (e) {
    return last
  }
}

// NOTE: intentionally NOT wrapped in withTimeout — this opens the system
// folder picker, which waits for the user for as long as it takes.
export async function requestFolder() {
  const res = await SAF().requestDirectoryPermissionsAsync()
  if (!res || !res.granted) return { granted: false, directoryUri: null }
  return { granted: true, directoryUri: res.directoryUri }
}

// Returns an array of child document URIs for the picked tree.
export async function listChildren(dirUri) {
  const uris = await withTimeout(() => SAF().readDirectoryAsync(dirUri), 'Reading the data folder')
  return Array.isArray(uris) ? uris : []
}

export async function findChildByName(dirUri, name) {
  const children = await listChildren(dirUri)
  for (const uri of children) {
    if (fileNameOf(uri) === name) return uri
  }
  return null
}

// NOTE: SAF createDocument dedupes names on collision ("tracker (1).json"),
// so callers MUST remove a same-name document via removeDocument() first.
//
// REGRESSION GUARD (remote-reported: 'clicked create default habit.json,
// it still cannot read it'): expo's signature is
//     StorageAccessFramework.createFileAsync(parentUri, fileName, mimeType)
// — fileName BEFORE mimeType. This adapter used to pass (dirUri, mime, name),
// so on a real device EVERY created document got the display name
// 'application/json' and the mime type 'habit.json' / 'habit.json.tmp'.
// The tmp + target documents were therefore never named habit.json, the
// next load() could not find the file, and the app bounced back to the
// 'No habit.json' screen — looking exactly like 'created it but cannot
// read it'. The unit suite never caught it because the SAF mock invented
// the same wrong parameter order the adapter used; the mock now mirrors
// expo's REAL signature (see __tests__/saf.test.js).
export async function createDocument(dirUri, name, mime = JSON_MIME) {
  return withTimeout(() => SAF().createFileAsync(dirUri, name, mime), `Creating ${name}`)
}

export async function removeDocument(uri) {
  await withTimeout(() => expoFs().deleteAsync(uri, { idempotent: true }), `Deleting ${fileNameOf(uri)}`)
}

export async function readDocument(uri) {
  return withTimeout(
    () => expoFs().readAsStringAsync(uri, { encoding: expoFs().EncodingType.UTF8 }),
    `Reading ${fileNameOf(uri)}`
  )
}

export async function writeDocument(uri, content) {
  await withTimeout(
    () => expoFs().writeAsStringAsync(uri, content, { encoding: expoFs().EncodingType.UTF8 }),
    `Writing ${fileNameOf(uri)}`
  )
}

export async function statDocument(uri) {
  try {
    const info = await withTimeout(() => expoFs().getInfoAsync(uri), `Checking ${fileNameOf(uri)}`)
    if (!info || !info.exists) return null
    return { exists: true, size: info.size, modificationTime: info.modificationTime }
  } catch (e) {
    return null
  }
}

// ---- App-private area (internal storage, NOT in the Syncthing folder) ----
// Used for the rolling .backups window: backup copies must not be synced to
// peers, so they live in the app's own documents directory.

export function appDocumentsDir() {
  return expoFs().documentDirectory
}

export async function ensureAppDir(dirUri) {
  await withTimeout(
    () => expoFs().makeDirectoryAsync(dirUri, { intermediates: true }),
    'Preparing the backup folder'
  )
}

export async function appWriteFile(fileUri, content) {
  // writeAsStringAsync creates missing file:// documents
  await withTimeout(
    () => expoFs().writeAsStringAsync(fileUri, content, { encoding: expoFs().EncodingType.UTF8 }),
    'Saving a backup'
  )
}

export async function appListDir(dirUri) {
  try {
    const entries = await withTimeout(() => expoFs().readDirectoryAsync(dirUri), 'Reading backups')
    if (!Array.isArray(entries)) return []
    // DEVICE-PARITY BUG (remote-reported 2026-09-18 class): Android's legacy
    // readDirectoryAsync returns BARE FILE NAMES for file:// directories
    // (native: `children.map { it?.name }`), not URIs. Every consumer of this
    // adapter (backup rotation pruning, the .corrupt window, restore-from-
    // backup) treats the entries as full URIs — on a real device deleteAsync/
    // readAsStringAsync got a bare name like "habit-backup-….json", which
    // parses as a scheme-less URI and fails ("Location '…' isn't deletable").
    // Normalize names to full URIs here so the adapter contract is uniform.
    return entries.map(e => (typeof e === 'string' && e.includes('://') ? e : dirUri + e))
  } catch (e) {
    return []
  }
}

export async function appDelete(uri) {
  await withTimeout(() => expoFs().deleteAsync(uri, { idempotent: true }), 'Cleaning up a backup')
}

// The FsAdapter instance handed to the tracker store.
export function createSafAdapter() {
  return {
    requestFolder,
    listChildren,
    findChildByName,
    createDocument,
    removeDocument,
    readDocument,
    writeDocument,
    statDocument,
    fileNameOf,
    // internal area
    appDocumentsDir,
    ensureAppDir,
    appWriteFile,
    appListDir,
    appDelete
  }
}
