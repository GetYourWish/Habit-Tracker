// tracker store — the Android app's single authority for reading and
// writing habit.json through a pluggable FsAdapter (SAF in production,
// in-memory in tests). Framework-free: React binds via getSnapshot/subscribe.
//
// Guarantees (mirroring desktop/electron/main.cjs + docs/SYNC-DESIGN.md):
//  - SCHEMA GATE: numeric schemaVersion > 1 is refused (SCHEMA_VERSION_TOO_NEW),
//    missing/non-number treated as 1. Refused files are never healed/written.
//  - NO-CHANGE-NO-WRITE: identical content never hits the disk.
//  - REBASE (SYNC-DESIGN Option A): every mutation batch first re-reads the
//    file; if another device wrote since our last load/write, the fresh
//    content is schema-gated + healed and the mutations are applied ON TOP
//    of it — the phone can never silently clobber a concurrent desktop edit.
//  - WRITE SERIALIZATION (the 2026-09 corrupt-file incident): expo's legacy
//    writeAsStringAsync opens the document with openOutputStream(uri, "w") —
//    which TRUNCATES — and streams the string through an OutputStreamWriter
//    in 8 KB chunks on its own coroutine. Two overlapping writes to the same
//    document therefore interleave their chunks and leave a corrupt file
//    (rapid theme switching in Settings used to fire exactly that: every
//    segmented-control tap launched its own full mutate → write pipeline
//    with nothing serializing them). ALL access now goes through a
//    readers-writer lock: loads may share the folder concurrently, but
//    writes are exclusive against everything, and new readers queue behind
//    a pending writer (write preference). Interleaved writes are
//    structurally impossible from this app.
//  - MUTATION BATCHING: mutations that arrive while a batch is writing
//    (theme-fiddling, quick board edits) are composed in order and written
//    in ONE verified cycle — one disk write per burst instead of a racing
//    write per tap.
//  - ATOMIC WRITE: content is written to a tmp document in the SAME
//    directory, read back and verified byte-for-byte, then the verified
//    content is written to the target document and the tmp removed. SAF has
//    no rename-clobber, so the final replace is a full-document write; the
//    verified tmp copy + the pre-write backup are the crash-recovery
//    layers. Partial content never reaches the target on purpose.
//  - TRUNCATION-PROOF TARGET WRITE (the 2026-09-21 'every action corrupts
//    the file' incident): several Android document providers do NOT
//    truncate an existing document opened for writing — a shorter write
//    leaves the previous content's tail bytes behind (a complete new JSON
//    followed by the old final '}' → "JSON Parse error: Unexpected
//    character: }"). The native layer now opens with the truncating "rwt"
//    mode (plugins/patch-expo-saf-truncate.js), and if the byte-verified
//    target write STILL comes back wrong, the target is RECREATED as a
//    fresh document (create + write + verify — the exact sequence that just
//    succeeded for the tmp sibling) inside the same cycle. A provider that
//    mangles in-place overwrites can no longer push the user into the
//    recovery flow.
//  - TRANSIENT-DAMAGE SETTLE: Syncthing pulls file blocks straight into the
//    destination file, so a read landing mid-sync observes garbage for a
//    moment. Before the corrupt-file state is entered (load, rebase or
//    post-write inspection), the document is re-read with a short settle
//    delay; only damage that persists across the retries is declared real
//    corruption — and a mid-sync rebase heals transparently, mutation
//    included.
//  - PRE-WRITE BACKUP (also from the 2026-09 incident): the CURRENT on-disk
//    content is copied into the app-private rolling .backups/ window before
//    EVERY real write — not just when overwriting an external change. A
//    damaged write can never be the last copy of anything: the previous
//    state is always recoverable from moments before the write.
//  - CORRUPT-FILE RECOVERY: when habit.json fails to parse, the damaged
//    bytes are FIRST preserved byte-for-byte in the app-private .corrupt/
//    window (nothing is ever destroyed), then the error state carries the
//    available recovery sources: the verified tmp sibling (a write cycle
//    interrupted mid-flight), the newest .backups/ copy, and the structural
//    salvager (src/storage/salvage.js — keeps every complete value, drops
//    only the damaged seam). Every restore path re-runs the schema gate +
//    heal before writing.
//  - CONFLICTS: Syncthing's tracker*-conflict-* copies are surfaced as a
//    list; never auto-loaded, never auto-deleted, never healed.
//  - WATCHDOG: SAF folder reads normally settle in well under a second; on
//    a few devices a stale persisted permission makes them hang forever.
//    A load that has not settled in LOAD_TIMEOUT_MS becomes an actionable
//    'no-folder' state (re-grant screen) instead — and force-releases its
//    read token so a dead provider cannot starve writers.
//
// SNAPSHOT CONTRACT (remote-reported 'stuck on Loading… forever'):
//  React's useSyncExternalStore only re-renders when getSnapshot() returns a
//  NEW reference — its checkIfSnapshotChanged() compares snapshots with
//  Object.is and silently drops the update when the reference is unchanged
//  (verified against the React 19.2 renderer bundled with RN 0.87). This
//  store therefore NEVER mutates the published state object: notify()
//  replaces it with a fresh one. An earlier version did
//  Object.assign(state, next) in place — every transition after the first
//  paint (folder picked, watchdog recovery, load success → 'ready', even a
//  fully successful load) was INVISIBLE to React, and the app sat on the
//  'Loading…' screen forever while the store underneath had long recovered.
//  The UI only ever repainted when an unrelated useState (booted/busy/tab)
//  happened to change — which is exactly what made the bug look like a
//  storage problem.

import { checkSchemaVersion, validateAndHealData, createDefaultData } from '@habit-tracker/core'
import {
  backupFileName,
  selectOldBackups,
  corruptFileName,
  selectOldCorrupt,
  isBackupName
} from './backups.js'
import { salvageJson } from './salvage.js'

// Matches Syncthing conflict copies of the data file, both the legacy
// tracker-*.json era and the current habit.json one
// (habit-sync-conflict-….json).
export const CONFLICT_PATTERN = /(tracker|habit).*-conflict-/

export const LOAD_TIMEOUT_MS = 15000
export const LOAD_TIMEOUT_MESSAGE =
  'Reading the data folder timed out. This usually means Android no longer honors the saved folder permission. Tap "Re-grant folder access" below and pick the folder again — your data was not modified.'

// Transient-damage settle (sync-client races): Syncthing pulls file blocks
// straight into the destination file, so a read that lands mid-sync observes
// garbage bytes for a moment — after which the very same document parses
// again. Declaring the file corrupt on such a transient read sends the user
// into the recovery flow for no reason (and can interrupt a legitimate
// mutation with CORRUPT_FILE). Before the corrupt state is entered, the
// document is re-read with a short settle delay; only damage that PERSISTS
// across the retries is treated as real corruption.
export const CORRUPT_SETTLE_ATTEMPTS = 3
export const CORRUPT_SETTLE_DELAY_MS = 700

// Test seam: the settle window is real wall-clock time on a device; tests
// need it instant (or shaped) to stay fast and deterministic. Production
// code always uses the constants above — this hook only ever runs from test
// setup files.
const settleCfg = { attempts: CORRUPT_SETTLE_ATTEMPTS, delayMs: CORRUPT_SETTLE_DELAY_MS }
export function setCorruptSettleForTests({ attempts, delayMs } = {}) {
  settleCfg.attempts = Number.isFinite(attempts) && attempts >= 0 ? attempts : settleCfg.attempts
  settleCfg.delayMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : settleCfg.delayMs
}

function tryParseRaw(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (e) {
    return { ok: false, error: e }
  }
}

function delay(ms) {
  if (ms <= 0) return Promise.resolve() // fast path: stays on the microtask queue
  return new Promise(resolve => setTimeout(resolve, ms))
}

function compactOf(value) {
  return JSON.stringify(value)
}

// --- readers-writer lock ----------------------------------------------------
//
// Loads (folder listing + reads) may run concurrently with each other — the
// loadSeq generation guard already decides which one may repaint state, and
// the 'newer load supersedes an older stalled one' recovery depends on that.
// Writes (anything that creates/writes/removes documents) are exclusive
// against reads AND writes, and new readers queue behind a pending writer.
// Tokens are single-release: the load watchdog force-releases a stalled
// load's token so a dead document provider can never starve writes.

function createRWLock() {
  let activeReaders = 0
  let activeWriter = false
  let nextId = 1
  const waiters = [] // { write, grant }

  function hasPendingWriter() {
    return waiters.some(w => w.write)
  }

  function pump() {
    if (activeWriter) return
    if (waiters.length > 0 && waiters[0].write) {
      if (activeReaders === 0) {
        const w = waiters.shift()
        activeWriter = true
        w.grant()
      }
      return // writer pending → readers behind it keep waiting (write preference)
    }
    while (waiters.length > 0 && !waiters[0].write) {
      const r = waiters.shift()
      activeReaders++
      r.grant()
    }
  }

  async function acquire(write) {
    const fastPath = write
      ? !activeWriter && activeReaders === 0 && !hasPendingWriter()
      : !activeWriter && !hasPendingWriter()
    if (fastPath) {
      if (write) activeWriter = true
      else activeReaders++
      return { id: nextId++, write, released: false }
    }
    return new Promise(grant => {
      const token = { id: nextId++, write, released: false }
      waiters.push({ write, grant: () => grant(token) })
    })
  }

  function release(token) {
    if (!token || token.released) return
    token.released = true
    if (token.write) activeWriter = false
    else activeReaders--
    pump()
  }

  return { read: () => acquire(false), write: () => acquire(true), release }
}

export function createTrackerStore({ adapter, dirUri, fileName = 'habit.json' }) {
  const listeners = new Set()

  // `let` on purpose: notify() REPLACES this object (see SNAPSHOT CONTRACT
  // above). getSnapshot() returns it directly, so between notifications the
  // reference is stable (required by useSyncExternalStore) and every notify
  // publishes a fresh reference (also required — React bails out otherwise).
  let state = {
    // 'no-folder' | 'loading' | 'ready' | 'missing' | 'schema-too-new' | 'error'
    status: dirUri ? 'loading' : 'no-folder',
    data: null, // healed data
    schemaVersion: null, // set when refused
    errorMessage: null, // corrupt JSON / IO errors
    conflicts: [], // Syncthing conflict file NAMES found in the folder
    // set when habit.json failed to parse:
    // { sources: { tmp?, backup? }, corruptSavedName, canSalvage }
    recovery: null,
    folderUri: dirUri || null,
    fileName
  }

  // --- internal refs (not part of the snapshot) ---
  const lock = createRWLock()
  let targetUri = null // resolved child document uri (null when missing)
  let knownRaw = null // raw string we believe is on disk (load or last write)
  let healedCompact = null // compact JSON of the healed data we hold
  let lastStat = null // { exists, size, modificationTime }
  let busy = false // write token held → polling skips
  let dirListing = [] // last child URIs (conflict detection)
  let loadSeq = 0 // generation guard: only the newest load may repaint state
  let lastBackupRaw = null // on-disk raw already sitting in .backups (dedupe)
  let lastCorrupt = null // { raw, name } — damaged bytes already preserved

  function notify(next) {
    // Immutably replace the snapshot — mutating in place made every store
    // transition invisible to useSyncExternalStore (Object.is bailout),
    // which froze the UI on 'Loading…' forever. See SNAPSHOT CONTRACT.
    state = { ...state, ...next }
    listeners.forEach(l => l())
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function getSnapshot() {
    return state
  }

  // --- helpers -----------------------------------------------------------

  function mobileTmpName() {
    // '.' + base + '.tmp.json' — see writeData for why it must end in
    // '.json' and must not be 'habit.json.tmp' (the desktop's own name).
    return '.' + state.fileName.replace(/\.json$/, '') + '.tmp.json'
  }

  async function listFolder() {
    dirListing = await adapter.listChildren(state.folderUri)
    const names = dirListing.map(u => adapter.fileNameOf(u))
    const conflicts = names.filter(n => CONFLICT_PATTERN.test(n))
    targetUri = null
    for (let i = 0; i < dirListing.length; i++) {
      if (names[i] === state.fileName) {
        targetUri = dirListing[i]
        break
      }
    }
    return conflicts
  }

  async function rotateBackup(rawContent, nowIso) {
    if (!rawContent) return
    const baseDir = adapter.appDocumentsDir()
    const backupDir = baseDir + '.backups/'
    await adapter.ensureAppDir(backupDir)
    await adapter.appWriteFile(backupDir + backupFileName(nowIso), rawContent)
    const children = await adapter.appListDir(backupDir)
    const names = children.map(u => adapter.fileNameOf(u))
    for (const name of selectOldBackups(names)) {
      const uri = children.find(u => adapter.fileNameOf(u) === name)
      if (uri) await adapter.appDelete(uri)
    }
  }

  // Preserve damaged bytes verbatim in the app-private .corrupt/ window
  // BEFORE any recovery option is offered — a botched restore can always be
  // undone by hand. Returns the evidence file name.
  async function preserveCorruptCopy(raw, nowIso) {
    const dir = adapter.appDocumentsDir() + '.corrupt/'
    await adapter.ensureAppDir(dir)
    const name = corruptFileName(nowIso)
    await adapter.appWriteFile(dir + name, raw)
    const children = await adapter.appListDir(dir)
    const names = children.map(u => adapter.fileNameOf(u))
    for (const old of selectOldCorrupt(names)) {
      const uri = children.find(u => adapter.fileNameOf(u) === old)
      if (uri) await adapter.appDelete(uri)
    }
    return name
  }

  // Which recovery sources exist for a damaged habit.json. The folder is
  // RE-LISTED first: when the corruption was caught by a mutation's write
  // cycle, the cached listing predates the tmp sibling that very cycle just
  // created — without the refresh, "Restore last verified copy" (the
  // byte-verified tmp) would be invisible exactly when it exists.
  async function findRecoverySources() {
    const sources = {}
    const tn = mobileTmpName()
    try {
      await listFolder()
    } catch (e) {
      /* listing failed — fall back to the cached listing below */
    }
    if (dirListing.some(u => adapter.fileNameOf(u) === tn)) sources.tmp = tn
    try {
      const backupDir = adapter.appDocumentsDir() + '.backups/'
      const children = await adapter.appListDir(backupDir)
      const names = children.map(u => adapter.fileNameOf(u)).filter(isBackupName).sort()
      if (names.length > 0) sources.backup = names[names.length - 1]
    } catch (e) {
      /* no backups dir yet — no source */
    }
    return sources
  }

  function gateOrThrow(parsed) {
    const gate = checkSchemaVersion(parsed)
    if (!gate.ok) {
      const err = new Error(gate.message)
      err.code = 'SCHEMA_VERSION_TOO_NEW'
      err.schemaVersion = gate.schemaVersion
      return err
    }
    return null
  }

  function parseGateHeal(raw, what) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      const err = new Error(`${what} is damaged as well: ${e.message}`)
      err.code = 'RECOVERY_SOURCE_CORRUPT'
      throw err
    }
    const gateErr = gateOrThrow(parsed)
    if (gateErr) throw gateErr
    return validateAndHealData(parsed)
  }

  // Settle a document that just failed to parse: re-read with a short delay
  // until it parses or the retries run out (see CORRUPT_SETTLE_* above).
  // Returns { raw, parse } where `parse` is the final parse attempt — the
  // caller decides what to do with a still-damaged document.
  async function readSettled(uri) {
    let raw = await adapter.readDocument(uri)
    for (let i = 0; i < settleCfg.attempts; i++) {
      const parse = tryParseRaw(raw)
      if (parse.ok) return { raw, parse }
      await delay(settleCfg.delayMs)
      const retry = await adapter.readDocument(uri).catch(() => null)
      if (retry == null) return { raw, parse } // unreadable now — report the last good read
      raw = retry
    }
    return { raw, parse: tryParseRaw(raw) }
  }

  // Corrupt-file entry: preserve evidence, discover sources, paint the
  // recovery state. The in-memory data/knownRaw caches are cleared — a
  // later restore must never be skipped by the no-change-no-write check.
  async function enterCorruptState(raw, parseErr, notifyIfCurrent) {
    let savedName = null
    try {
      if (raw) {
        if (lastCorrupt && lastCorrupt.raw === raw) {
          savedName = lastCorrupt.name
        } else {
          savedName = await preserveCorruptCopy(raw, new Date().toISOString())
          lastCorrupt = { raw, name: savedName }
        }
      }
    } catch (e) {
      /* preservation is best-effort — recovery options are still offered */
    }
    const sources = await findRecoverySources()
    knownRaw = null
    healedCompact = null
    notifyIfCurrent({
      status: 'error',
      data: null,
      errorMessage: 'Corrupt JSON: ' + parseErr.message,
      recovery: { sources, corruptSavedName: savedName, canSalvage: true }
    })
  }

  // Core load body (runs under a READ token; no lock acquisition inside —
  // callers own the token). Generation-guarded via notifyIfCurrent.
  // `quiet` skips the intermediate 'loading' repaint: a background poll that
  // finds an external change must NOT flash the full-screen loading spinner
  // over a perfectly good board — it repaints straight to the fresh content
  // (or the error state if the fresh content is damaged).
  async function runLoad(gen, { quiet = false } = {}) {
    const notifyIfCurrent = next => {
      if (gen === loadSeq) notify(next)
      return gen === loadSeq
    }
    if (!state.folderUri) {
      notifyIfCurrent({ status: 'no-folder' })
      return state
    }
    if (!quiet) notifyIfCurrent({ status: 'loading', errorMessage: null })
    try {
      const conflicts = await listFolder()
      lastStat = targetUri ? await adapter.statDocument(targetUri) : null

      if (!targetUri) {
        notifyIfCurrent({ status: 'missing', data: null, conflicts, lastMissingAt: Date.now() })
        return state
      }

      const raw = await adapter.readDocument(targetUri)
      let parse = tryParseRaw(raw)
      let currentRaw = raw
      if (!parse.ok) {
        // transient mid-sync damage (Syncthing writes blocks into the
        // destination file) heals within a moment — settle before declaring
        // the file corrupt
        const settled = await readSettled(targetUri)
        currentRaw = settled.raw
        if (settled.parse.ok) {
          parse = settled.parse
        } else {
          await enterCorruptState(settled.raw, settled.parse.error, notifyIfCurrent)
          return state
        }
      }

      const gateErr = gateOrThrow(parse.value)
      if (gateErr) {
        notifyIfCurrent({
          status: 'schema-too-new',
          data: null,
          schemaVersion: gateErr.schemaVersion,
          conflicts
        })
        return state
      }

      const healed = validateAndHealData(parse.value)
      knownRaw = currentRaw
      healedCompact = compactOf(healed)
      notifyIfCurrent({
        status: 'ready',
        data: healed,
        conflicts,
        schemaVersion: null,
        errorMessage: null,
        recovery: null
      })
      return state
    } catch (e) {
      // SAF permission lost (reboot/app standby) or folder gone → setup again
      notifyIfCurrent({ status: 'no-folder', errorMessage: e.message })
      return state
    }
  }

  // Public load: read token + the 15 s watchdog. The watchdog ALSO
  // force-releases the token — a document provider that never answers must
  // not pin the lock and starve writes forever.
  async function load() {
    const gen = ++loadSeq
    const notifyIfCurrent = next => {
      if (gen === loadSeq) notify(next)
      return gen === loadSeq
    }
    if (!state.folderUri) {
      notifyIfCurrent({ status: 'no-folder' })
      return state
    }
    const token = await lock.read()
    let watchdog = null
    try {
      watchdog = setTimeout(() => {
        notifyIfCurrent({ status: 'no-folder', errorMessage: LOAD_TIMEOUT_MESSAGE })
        lock.release(token)
      }, LOAD_TIMEOUT_MS)
      return await runLoad(gen)
    } finally {
      if (watchdog) clearTimeout(watchdog)
      lock.release(token)
    }
  }

  // External-change poll: cheap stat first; reload only when changed.
  // `force` bypasses the stat comparison (pull-to-refresh). Runs under a
  // READ token; the reload reuses the SAME token (no nested acquisition).
  async function checkExternal(force = false) {
    if (busy) return false
    if (!state.folderUri) return false
    if (state.status !== 'ready' && state.status !== 'missing' && !force) return false
    const token = await lock.read()
    try {
      const conflicts = await listFolder()
      const stat = targetUri ? await adapter.statDocument(targetUri) : null

      const sameStat =
        lastStat && stat
          ? lastStat.size === stat.size && lastStat.modificationTime === stat.modificationTime
          : lastStat === stat // both null, or one side vanished

      notifyConflictsIfChanged(conflicts)
      if (!force && sameStat && state.status !== 'schema-too-new') return false
      // quiet: the user is looking at a working board — an external change
      // (Syncthing landed a desktop edit) repaints in place, no loading flash
      await runLoad(++loadSeq, { quiet: true })
      return true
    } catch (e) {
      // permission lost while backgrounded — surface setup screen
      notify({ status: 'no-folder', errorMessage: e.message })
      return false
    } finally {
      lock.release(token)
    }
  }

  function notifyConflictsIfChanged(conflicts) {
    const prev = state.conflicts
    if (prev.length !== conflicts.length || prev.some((n, i) => n !== conflicts[i])) {
      notify({ conflicts })
    }
  }

  // --- write path ---------------------------------------------------------

  // Persist `nextData` (already healed-shaped) with all guarantees above.
  // MUST be called with the WRITE token held.
  async function writeData(nextData, { backupRaw = null } = {}) {
    const nextCompact = compactOf(nextData)
    if (nextCompact === healedCompact) {
      notify({ data: nextData })
      return { skipped: true }
    }

    // PRE-WRITE BACKUP: the current on-disk content is copied into the
    // app-private rolling .backups/ window BEFORE the target is touched —
    // no matter who wrote those bytes (us or another device). A damaged
    // write can never be the last copy of anything. Deduped against the
    // previous backup so burst writes rotate one copy, not one per tap.
    if (backupRaw && backupRaw !== lastBackupRaw) {
      await rotateBackup(backupRaw, new Date().toISOString())
      lastBackupRaw = backupRaw
    }

    const pretty = JSON.stringify(nextData, null, 2) // desktop atomicSave format

    // refresh the directory listing (the target may have appeared/vanished)
    await listFolder()

    // 1) tmp document in the SAME directory, verified byte-for-byte.
    //
    //    The tmp display name is platform-safe on purpose:
    //     - It must END with '.json' — Android's DocumentsContract appends the
    //       MIME-derived extension to any display name that lacks it, so a
    //       'habit.json.tmp' document is actually created as
    //       'habit.json.tmp.json', which exact-name cleanup can never find.
    //     - It must NOT be 'habit.json.tmp' — that is the DESKTOP app's own
    //       atomicSave temp file, synced into this folder by Syncthing while
    //       the desktop is mid-save; removing it (the stale-tmp cleanup below)
    //       would break the desktop's rename. A leading dot keeps ours
    //       distinct and is ignored by the desktop's file watcher.
    const tmpName = mobileTmpName()
    const existingTmp = dirListing.find(u => adapter.fileNameOf(u) === tmpName)
    if (existingTmp) await adapter.removeDocument(existingTmp)
    const tmpUri = await adapter.createDocument(state.folderUri, tmpName)
    await adapter.writeDocument(tmpUri, pretty)
    const verify = await adapter.readDocument(tmpUri)
    if (verify !== pretty) {
      await adapter.removeDocument(tmpUri).catch(() => {})
      throw new Error('Temporary write verification failed — target left untouched')
    }

    // 2) replace the target (full-document write; tmp remains as recovery
    //    copy until the very end)
    if (!targetUri) {
      const created = await adapter.createDocument(state.folderUri, state.fileName)
      // SAF dedupes on a name collision ("tracker (1).json") — a habit.json
      // that appeared between the listing and this create must not silently
      // redirect our writes into a misnamed sibling.
      if (adapter.fileNameOf(created) !== state.fileName) {
        await adapter.removeDocument(created).catch(() => {})
        throw new Error('habit.json appeared in the folder mid-save — nothing was overwritten; try again')
      }
      targetUri = created
    }
    await adapter.writeDocument(targetUri, pretty)

    let finalVerify = await adapter.readDocument(targetUri)
    if (finalVerify !== pretty) {
      // PROVIDER-QUIRK REPAIR (the 2026-09-21 'every action corrupts the
      // file' incident): some Android document providers do not truncate an
      // EXISTING document when it is opened for writing — a shorter write
      // leaves the previous content's tail bytes behind (a complete new JSON
      // followed by the old final '}' → "JSON Parse error: Unexpected
      // character: }"). The write that just FAILED against the existing
      // document is the same write that SUCCEEDED against the freshly
      // created tmp sibling moments ago, so the reliable path on this
      // device is: recreate the target as a FRESH document. The byte-verified
      // tmp copy is still on disk and the pre-write backup is already
      // rotated — the repair runs inside the same crash-recovery envelope.
      await adapter.removeDocument(targetUri).catch(() => {})
      const recreated = await adapter.createDocument(state.folderUri, state.fileName)
      if (adapter.fileNameOf(recreated) !== state.fileName) {
        // SAF dedupes the display name on collision ("tracker (1).json") —
        // the old document never went away. Drop the misnamed copy; the
        // recovery surface (tmp + backup) stays intact for the user.
        await adapter.removeDocument(recreated).catch(() => {})
        throw new Error('Could not replace habit.json — a same-named document stayed locked in the folder')
      }
      targetUri = recreated
      await adapter.writeDocument(targetUri, pretty)
      finalVerify = await adapter.readDocument(targetUri)
      if (finalVerify !== pretty) {
        throw new Error('Final write verification failed twice (in-place and recreated) — habit.json was not accepted as saved')
      }
    }

    // 3) drop the tmp artifact
    await adapter.removeDocument(tmpUri).catch(() => {})

    knownRaw = pretty
    healedCompact = nextCompact
    lastStat = await adapter.statDocument(targetUri)
    return { skipped: false }
  }

  // Apply a batch of pure mutations with the REBASE semantics described at
  // the top. buildNext(baseHealedData, nowIso) → nextData; the batch is
  // composed in arrival order onto ONE rebased base and written in ONE
  // verified cycle. Throws SchemaTooNewError when the rebased file was
  // written by a newer app (mutation aborted, file safe).
  // MUST be called with the WRITE token held.
  async function runMutationBatch(batch) {
    if (!state.folderUri || state.status === 'schema-too-new') {
      throw new Error('Cannot save: no writable data file loaded')
    }
    // invalidate in-flight loads: a zombie load released by the watchdog
    // must never repaint over this batch's result
    ++loadSeq

    // REBASE: always mutate on top of the newest on-disk content.
    let base
    let freshRaw = null
    try {
      freshRaw = targetUri ? await adapter.readDocument(targetUri) : null
    } catch (e) {
      freshRaw = null // file vanished — write will recreate it
    }
    if (freshRaw != null && freshRaw !== knownRaw) {
      let parse = tryParseRaw(freshRaw)
      if (!parse.ok && targetUri) {
        // transient mid-sync damage (Syncthing writing blocks into the
        // destination) must not kill a legitimate mutation — settle first
        const settled = await readSettled(targetUri)
        freshRaw = settled.raw
        parse = settled.parse
      }
      if (!parse.ok) {
        // The damage persists: preserve those bytes and move straight to
        // recovery; keeping the settings or board screen active would invite
        // further unsaveable edits.
        await enterCorruptState(freshRaw, parse.error, next => notify(next))
        const err = new Error(
          'habit.json on disk is damaged. Recovery is now open; nothing was saved over the damaged file.'
        )
        err.code = 'CORRUPT_FILE'
        throw err
      }
      const gateErr = gateOrThrow(parse.value)
      if (gateErr) {
        notify({
          status: 'schema-too-new',
          data: null,
          schemaVersion: gateErr.schemaVersion
        })
        throw gateErr
      }
      base = validateAndHealData(parse.value)
      knownRaw = freshRaw
      healedCompact = compactOf(base)
    } else {
      base = state.data
    }
    if (!base) base = createDefaultData()

    // compose the burst: every queued mutation applies on top of the
    // previous one — exactly the sequential semantics, one disk write
    let next = base
    for (const m of batch) {
      next = m.buildNext(next, new Date().toISOString())
    }

    let result
    try {
      result = await writeData(next, { backupRaw: freshRaw })
    } catch (writeError) {
      // If final verification failed (even after the recreate repair), inspect
      // the target once more — with the transient settle guard, because a
      // sync client can also be mid-flight on the destination right now. A
      // persistently damaged target follows the same evidence-preserving
      // recovery route as a damaged rebase read instead of leaving a
      // deceptive ready screen.
      if (targetUri) {
        const settled = await readSettled(targetUri).catch(() => null)
        if (settled && !settled.parse.ok) {
          await enterCorruptState(settled.raw, settled.parse.error, nextState => notify(nextState))
          const err = new Error('habit.json was damaged during saving. Recovery is now open; nothing else will be written.')
          err.code = 'CORRUPT_FILE'
          throw err
        }
      }
      throw writeError
    }
    notify({ data: next, status: 'ready', errorMessage: null })
    return { ...result, data: next }
  }

  // --- mutations (queued + coalesced) -------------------------------------
  //
  // mutate() never touches storage directly: it appends to a pending list
  // and a single flush task drains it under the WRITE token. Mutations that
  // arrive while a batch is writing join the NEXT batch — a rapid burst of
  // theme taps produces ONE verified write of the final state, and no two
  // writes from this store can ever overlap (the 2026-09 corruption was
  // exactly two overlapping writeAsStringAsync calls interleaving their
  // chunked output inside the SAF provider).

  let pendingMutations = []
  let flushScheduled = false

  function mutate(buildNext) {
    return new Promise((resolve, reject) => {
      pendingMutations.push({ buildNext, resolve, reject })
      if (!flushScheduled) {
        flushScheduled = true
        Promise.resolve().then(flushMutations)
      }
    })
  }

  async function flushMutations() {
    flushScheduled = false
    if (pendingMutations.length === 0) return
    const token = await lock.write()
    busy = true
    try {
      // keep draining while more mutations arrived mid-write
      while (pendingMutations.length > 0) {
        const batch = pendingMutations
        pendingMutations = []
        let outcome = null
        let failure = null
        try {
          outcome = await runMutationBatch(batch)
        } catch (e) {
          failure = e
        }
        for (const m of batch) {
          if (failure) m.reject(failure)
          else m.resolve(outcome)
        }
        if (failure && failure.code === 'CORRUPT_FILE') {
          // Do not process taps queued while recovery was opening: state.data
          // is deliberately cleared, and applying them could overwrite the
          // damaged file with a fresh default document.
          const aborted = pendingMutations
          pendingMutations = []
          for (const m of aborted) m.reject(failure)
          return
        }
      }
    } finally {
      busy = false
      lock.release(token)
    }
  }

  // First-run helper: write createDefaultData() into the picked folder.
  async function initializeDefault() {
    const token = await lock.write()
    busy = true
    try {
      ++loadSeq
      const def = createDefaultData()
      // Guard: if a habit.json appeared since the 'missing' screen was
      // painted (sync finished mid-flight, or an earlier broken build left
      // one behind), re-list so we WRITE INTO it instead of letting SAF's
      // createDocument dedupe it into 'tracker (1).json' — and keep a backup
      // of its content before defaults overwrite it.
      let backupRaw = null
      try {
        await listFolder()
        if (targetUri) backupRaw = await adapter.readDocument(targetUri)
      } catch (e) {
        // unreadable or absent — writeData surfaces any real error
      }
      const result = await writeData(def, { backupRaw })
      notify({ data: def, status: 'ready', errorMessage: null })
      return { ...result, data: def }
    } finally {
      busy = false
      lock.release(token)
    }
  }

  // desktop 'backup-now' IPC: copy current on-disk content into .backups/
  async function backupNow() {
    const token = await lock.read()
    try {
      const raw = targetUri ? await adapter.readDocument(targetUri) : null
      await rotateBackup(raw, new Date().toISOString())
      if (raw) lastBackupRaw = raw
      return true
    } finally {
      lock.release(token)
    }
  }

  // --- corrupt-file recovery (write side) ----------------------------------

  // Restore habit.json from the verified tmp sibling ('tmp') or the
  // newest app-private backup ('backup'). Both re-run the schema gate +
  // heal; the damaged on-disk bytes are preserved in .corrupt/ first.
  async function restoreFrom(source) {
    const token = await lock.write()
    busy = true
    try {
      ++loadSeq
      let raw = null
      let tmpUri = null
      if (source === 'tmp') {
        await listFolder()
        const tn = mobileTmpName()
        tmpUri = dirListing.find(u => adapter.fileNameOf(u) === tn) || null
        if (!tmpUri) {
          throw new Error('The recovery copy is no longer in the folder — reload and pick another option.')
        }
        raw = await adapter.readDocument(tmpUri)
      } else if (source === 'backup') {
        const name = state.recovery && state.recovery.sources ? state.recovery.sources.backup : null
        if (!name) throw new Error('No backup was found in the app’s private storage.')
        const backupDir = adapter.appDocumentsDir() + '.backups/'
        const children = await adapter.appListDir(backupDir)
        const uri = children.find(u => adapter.fileNameOf(u) === name)
        if (!uri) throw new Error('The backup file could not be found.')
        raw = await adapter.readDocument(uri)
      } else {
        throw new Error('Unknown recovery source: ' + source)
      }

      const healed = parseGateHeal(raw, source === 'tmp' ? 'The recovery copy' : 'The backup copy')

      // preserve the damaged on-disk bytes before overwriting them
      let currentRaw = null
      try {
        currentRaw = targetUri ? await adapter.readDocument(targetUri) : null
      } catch (e) {
        currentRaw = null
      }
      if (currentRaw && (!lastCorrupt || lastCorrupt.raw !== currentRaw)) {
        const name = await preserveCorruptCopy(currentRaw, new Date().toISOString())
        lastCorrupt = { raw: currentRaw, name }
      }

      // backupRaw intentionally null: the corrupt bytes are preserved in
      // .corrupt/ — .backups/ must never gain a damaged copy (a later
      // 'restore latest backup' would then offer corrupt bytes).
      await writeData(healed, { backupRaw: null })
      if (tmpUri) await adapter.removeDocument(tmpUri).catch(() => {})
      notify({
        data: healed,
        status: 'ready',
        errorMessage: null,
        recovery: null,
        schemaVersion: null
      })
      return { data: healed }
    } finally {
      busy = false
      lock.release(token)
    }
  }

  // Structural salvage of the damaged file (see salvage.js). Keeps every
  // complete value; only the damaged seam's entries are dropped. The
  // damaged original is preserved in .corrupt/ first, as everywhere.
  async function salvageRepair() {
    const token = await lock.write()
    busy = true
    try {
      ++loadSeq
      let raw = null
      try {
        raw = targetUri ? await adapter.readDocument(targetUri) : null
      } catch (e) {
        raw = null
      }
      if (raw == null) throw new Error('habit.json could not be read — nothing to salvage.')

      const outcome = salvageJson(raw)
      if (!outcome.ok) throw new Error('Salvage failed: ' + outcome.reason)
      if (!outcome.value || typeof outcome.value !== 'object' || Array.isArray(outcome.value)) {
        throw new Error('Salvage produced something other than a data object — the file is too damaged.')
      }
      const gateErr = gateOrThrow(outcome.value)
      if (gateErr) throw gateErr
      const healed = validateAndHealData(outcome.value)

      if (!lastCorrupt || lastCorrupt.raw !== raw) {
        const name = await preserveCorruptCopy(raw, new Date().toISOString())
        lastCorrupt = { raw, name }
      }

      await writeData(healed, { backupRaw: null })
      notify({
        data: healed,
        status: 'ready',
        errorMessage: null,
        recovery: null,
        schemaVersion: null
      })
      return {
        data: healed,
        droppedBytes: outcome.droppedBytes,
        resyncs: outcome.resyncs
      }
    } finally {
      busy = false
      lock.release(token)
    }
  }

  async function setFolder(newDirUri) {
    notify({ folderUri: newDirUri, status: newDirUri ? 'loading' : 'no-folder' })
    return load()
  }

  return {
    // react binding
    subscribe,
    getSnapshot,
    // lifecycle
    load,
    checkExternal,
    setFolder,
    initializeDefault,
    backupNow,
    // recovery
    restoreFrom,
    salvageRepair,
    // mutations
    mutate
  }
}

// exported for tests / UI messaging
export function isSchemaTooNewError(err) {
  return !!err && err.code === 'SCHEMA_VERSION_TOO_NEW'
}
