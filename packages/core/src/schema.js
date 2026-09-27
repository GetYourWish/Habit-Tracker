// schema.js — schema version gate + idempotent validate & heal for habit.json.
// The gate is the ONLY authority on whether a habit.json may be loaded:
// a file written by a NEWER app version (numeric schemaVersion > 1) is
// refused, never silently healed downgraded. Missing/non-number is
// treated as 1 (legacy files).

const { createDefaultData, stableId } = require('./defaults')
const { isValidSlotKey } = require('./times')
const { systemFrequencies } = require('./recurrence')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Returns { ok: true } when the file may be loaded, or
// { ok: false, schemaVersion, message } when it must be refused.
function checkSchemaVersion(data) {
  const sv = data && typeof data === 'object' ? data.schemaVersion : undefined
  if (typeof sv === 'number' && sv > 1) {
    return {
      ok: false,
      schemaVersion: sv,
      message: `SCHEMA_VERSION_TOO_NEW:${sv}`
    }
  }
  return { ok: true }
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v))
}

// Validate and heal data.
// NOTE: healing is idempotent — healing an already-valid file returns a
// deep-equal structure. In particular meta.updatedAt is NOT touched here:
// bumping it on every load caused a rewrite on every start (and endless
// Syncthing churn). Mutating actions bump updatedAt explicitly when saving.
//
// Normative behavior is documented in SCHEMA.md ("Healing") and locked by
// the golden fixtures (tests/fixture-contract.cjs). Changes here are a
// BREAKING change to the drift contract.

// ---- frequencies (the cadence catalogue) ---------------------------------
// THE 2026-09-27 fix. A habit's editor and Today page resolve
// habit.frequencyId against data.frequencies. Legacy task-era files ship NO
// catalogue at all, and the editor's fallback (systemFrequencies()) carries
// NO ids — every "How often?" chip then compared undefined === undefined,
// rendered ALL-picked and unchangeable, and habits saved from that state got
// frequencyId: undefined, which parked them in "resting today" with a dead
// check button. Healing now guarantees the catalogue exists, is id-bearing
// and every habit points at a real entry:
//   1. no frequencies array → seed the system catalogue (stable ids)
//   2. id-less entries → stableId('freq:' + key) (same ids the defaults seed)
//   3. missing system cadences → appended (the documented `system: true`
//      "restored by healing" contract, finally implemented)
//   4. habits with a missing/unknown frequencyId → pointed at "Every day"
// All of it idempotent: a healthy file heals byte-identically.
function healFrequencies(healed) {
  let list
  if (Array.isArray(healed.frequencies)) {
    list = healed.frequencies
  } else {
    list = []
    healed.frequencies = list
  }

  const byKey = {}
  for (const f of list) {
    if (f && typeof f === 'object' && typeof f.key === 'string' && f.key) {
      byKey[f.key] = f
    }
  }

  // 2. every entry must carry an id the editor can point at.
  for (const f of list) {
    if (!f || typeof f !== 'object') continue
    if (typeof f.id === 'string' && f.id) continue
    f.id = typeof f.key === 'string' && f.key
      ? stableId(`freq:${f.key}`)
      : stableId(`freq:custom:${f.label || 'cadence'}:${list.indexOf(f)}`)
  }

  // 3. restore missing system cadences (skipped when the key is taken).
  for (const sys of systemFrequencies()) {
    if (byKey[sys.key]) continue
    list.push({ ...sys, id: stableId(`freq:${sys.key}`), createdAt: '1970-01-01T00:00:00.000Z' })
  }

  // 4. habits pointing at nothing (or a deleted cadence) fall back to the
  // daily id — the same stableId the defaults use, so it matches the entry
  // seeded by step 3 even on files that had no catalogue at all.
  if (Array.isArray(healed.habits) && healed.habits.length) {
    const ids = new Set(
      list.filter(f => f && typeof f === 'object' && typeof f.id === 'string' && f.id).map(f => f.id)
    )
    if (!ids.size) return
    const dailyId = stableId('freq:daily')
    const fallback = ids.has(dailyId) ? dailyId : list.find(f => f && f.id).id
    for (const h of healed.habits) {
      if (!h || typeof h !== 'object') continue
      if (!h.frequencyId || !ids.has(h.frequencyId)) h.frequencyId = fallback
    }
  }
}

function validateAndHealData(data) {
  if (!data) {
    return createDefaultData()
  }

  // Work on a deep copy so healing NEVER mutates the caller's object.
  // Structured clone keeps key insertion order, which matters because the
  // main process persists only when the serialized output differs from what
  // was read (byte-identical healing of clean files => no rewrite).
  const healed = JSON.parse(JSON.stringify(data))

  // Ensure required sections exist. New keys are APPENDED only when the
  // source key is absent — never reordered or injected in the middle — so
  // healing a clean file re-serializes byte-identically (anti-churn rule).
  if (!healed.schemaVersion) healed.schemaVersion = 1
  if (!healed.meta || typeof healed.meta !== 'object') {
    healed.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  }
  if (!healed.settings || typeof healed.settings !== 'object') healed.settings = {}
  healFrequencies(healed)
  if (!Array.isArray(healed.categories)) healed.categories = []
  if (!Array.isArray(healed.board)) healed.board = []
  if (!Array.isArray(healed.difficulties)) healed.difficulties = []
  if (!Array.isArray(healed.markers)) healed.markers = []
  if (!Array.isArray(healed.tasks)) healed.tasks = []
  if (!Array.isArray(healed.workingOn)) healed.workingOn = []
  if (!Array.isArray(healed.logs)) healed.logs = []

  // ---- completions (habit model) -------------------------------------------
  // Only touch completions/habits when the file actually uses the habit
  // model — legacy task-board files must not gain a `completions` key, or
  // healing would re-serialize differently and trigger rewrite churn.
  if (Array.isArray(healed.habits)) {
    if (!Array.isArray(healed.completions)) healed.completions = []
    const habitIds = new Set(
      healed.habits.filter(h => h && typeof h === 'object' && h.id).map(h => h.id)
    )
    const seenComp = new Set()
    healed.completions = healed.completions.filter(c => {
      if (!c || typeof c !== 'object' || !c.id || seenComp.has(c.id)) return false
      if (!habitIds.has(c.habitId)) return false
      if (typeof c.date !== 'string' || !DATE_RE.test(c.date)) return false
      seenComp.add(c.id)
      return true
    })
    // Slot hygiene (idempotent): a completion may record which time-of-day
    // occurrence it satisfied (c.slot). Unknown slot values are dropped —
    // never the completion itself — so healing never loses history.
    for (const c of healed.completions) {
      if ('slot' in c && !isValidSlotKey(c.slot)) delete c.slot
    }
    healed.completions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    // Recompute derived lastCompletedDate from history (cross-device merge
    // fix). Only maintained for habits that already carry the field — adding
    // it to seeded/legacy habits would break the byte-identical heal rule.
    const latestByHabit = {}
    for (const c of healed.completions) {
      if (!latestByHabit[c.habitId] || c.date >= latestByHabit[c.habitId]) latestByHabit[c.habitId] = c.date
    }
    for (const habit of healed.habits) {
      if (!habit || typeof habit !== 'object' || !habit.id) continue
      if (!('lastCompletedDate' in habit)) continue
      const derived = latestByHabit[habit.id] || null
      if (habit.lastCompletedDate !== derived) habit.lastCompletedDate = derived
    }
  }

  // ---- tasks ---------------------------------------------------------------
  // Coerce task text to string (legacy files may hold numbers/null).
  // Malformed entries are dropped from references but preserved in place
  // inside `tasks` itself (data retention; healing must not silently delete
  // user content it does not understand).
  const validTasks = healed.tasks.filter(t => t && typeof t === 'object' && t.id)
  for (const task of validTasks) {
    task.text = str(task.text)
  }
  const taskIds = new Set(validTasks.map(t => t.id))
  const activeTaskIds = new Set(validTasks.filter(t => !t.completion).map(t => t.id))

  // ---- markers -------------------------------------------------------------
  const markerIds = new Set(
    healed.markers.filter(m => m && typeof m === 'object' && m.id).map(m => m.id)
  )

  // ---- board ---------------------------------------------------------------
  // Drop malformed rows, rows pointing at missing tasks / completed tasks /
  // missing markers, and duplicate references. Order of survivors is kept.
  // Habit-model rows ({type:'habit', habitId}) are validated against the
  // habits list when present — dropping them would wipe the seeded starter
  // board on every load and trigger endless rewrite churn.
  const habitIdsForBoard = Array.isArray(healed.habits)
    ? new Set(healed.habits.filter(h => h && typeof h === 'object' && h.id).map(h => h.id))
    : null
  const seenTaskRefs = new Set()
  const seenMarkerRefs = new Set()
  const seenHabitRefs = new Set()
  healed.board = healed.board.filter(item => {
    if (!item || typeof item !== 'object') return false
    if (item.type === 'habit') {
      const id = item.habitId
      if (!id) return false
      if (habitIdsForBoard && !habitIdsForBoard.has(id)) return false
      if (seenHabitRefs.has(id)) return false
      seenHabitRefs.add(id)
      return true
    }
    if (item.type === 'task') {
      const id = item.taskId
      if (!id || !taskIds.has(id) || !activeTaskIds.has(id)) return false
      if (seenTaskRefs.has(id)) return false
      seenTaskRefs.add(id)
      return true
    }
    if (item.type === 'marker') {
      const id = item.markerId
      if (!id || !markerIds.has(id)) return false
      if (seenMarkerRefs.has(id)) return false
      seenMarkerRefs.add(id)
      return true
    }
    return false
  })
  // Every ACTIVE task belongs on the board; heal-inserted entries omit `id`.
  for (const task of validTasks) {
    if (!task.completion && !seenTaskRefs.has(task.id)) {
      healed.board.push({ type: 'task', taskId: task.id })
      seenTaskRefs.add(task.id)
    }
  }

  // ---- workingOn -----------------------------------------------------------
  // Drop ids whose task vanished or is already completed.
  healed.workingOn = healed.workingOn.filter(id => typeof id === 'string' && activeTaskIds.has(id))

  // logs capped to prevent unbounded growth (keep newest 500)
  if (healed.logs.length > 500) {
    healed.logs = healed.logs.slice(healed.logs.length - 500)
  }

  return healed
}

module.exports = { checkSchemaVersion, validateAndHealData }
