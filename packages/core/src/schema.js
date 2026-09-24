// schema.js — schema version gate + idempotent validate & heal for habit.json.
// The gate is the ONLY authority on whether a habit.json may be loaded:
// a file written by a NEWER app version (numeric schemaVersion > 1) is
// refused, never silently healed downgraded. Missing/non-number is
// treated as 1 (legacy files).

const { createDefaultData } = require('./defaults')
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

let healCounter = 0
function healId(prefix) {
  healCounter += 1
  return `${prefix}-healed-${healCounter.toString(36)}-${Date.now().toString(36)}`
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v))
}

// Validate and heal data.
// NOTE: healing is idempotent — healing an already-valid file returns a
// deep-equal structure. In particular meta.updatedAt is NOT touched here:
// bumping it on every load caused a rewrite on every start (and endless
// Syncthing churn). Mutating actions bump updatedAt explicitly when saving.
function validateAndHealData(data) {
  if (!data) {
    return createDefaultData()
  }

  const healed = { ...data }

  // Ensure required sections exist
  if (!healed.schemaVersion) healed.schemaVersion = 1
  if (!healed.meta || typeof healed.meta !== 'object') {
    healed.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  }
  if (!healed.settings || typeof healed.settings !== 'object') healed.settings = {}
  if (!Array.isArray(healed.frequencies)) healed.frequencies = []
  if (!Array.isArray(healed.categories)) healed.categories = []
  if (!Array.isArray(healed.habits)) healed.habits = []
  if (!Array.isArray(healed.board)) healed.board = []
  if (!Array.isArray(healed.completions)) healed.completions = []
  if (!Array.isArray(healed.logs)) healed.logs = []

  // ---- frequencies -------------------------------------------------------
  // Restore missing SYSTEM cadences (matched by key). Existing entries are
  // user-owned: edits are never overwritten. A deleted system frequency comes
  // back so habits referencing it keep working.
  const freqKeySet = new Set()
  healed.frequencies = healed.frequencies.filter(f => f && typeof f === 'object' && f.id && !freqKeySet.has(str(f.key) || `__noid${freqKeySet.size}`) && freqKeySet.add(str(f.key)))
  for (const sys of systemFrequencies()) {
    if (!healed.frequencies.some(f => str(f.key) === sys.key)) {
      healed.frequencies.push({ ...sys, id: healId('freq'), createdAt: new Date().toISOString() })
    }
  }
  const freqIds = new Set(healed.frequencies.map(f => f.id))
  const defaultFreq = healed.frequencies.find(f => str(f.key) === 'daily') || healed.frequencies[0]

  // ---- habits ------------------------------------------------------------
  healed.habits = healed.habits.filter(h => h && typeof h === 'object' && h.id)
  for (const habit of healed.habits) {
    habit.title = str(habit.title)
    habit.icon = str(habit.icon, '✨')
    if (!freqIds.has(habit.frequencyId)) habit.frequencyId = defaultFreq ? defaultFreq.id : null
    if (typeof habit.archived !== 'boolean') habit.archived = !!habit.completed // legacy field name
  }
  const habitIds = new Set(healed.habits.map(h => h.id))

  // categories: drop malformed / duplicates
  const catNames = new Set()
  healed.categories = healed.categories.filter(c => {
    if (!c || typeof c !== 'object' || !c.id) return false
    const n = str(c.name)
    if (catNames.has(n)) return false
    catNames.add(n)
    c.name = n
    return true
  })
  const catIds = new Set(healed.categories.map(c => c.id))
  for (const habit of healed.habits) {
    if (habit.categoryId != null && !catIds.has(habit.categoryId)) habit.categoryId = null
  }

  // ---- completions ---------------------------------------------------------
  // Drop orphans (unknown habit or bad date), de-duplicate ids, sort
  // chronologically (stable by id) so both apps serialize identically.
  const seenComp = new Set()
  healed.completions = healed.completions.filter(c => {
    if (!c || typeof c !== 'object' || !c.id || seenComp.has(c.id)) return false
    if (!habitIds.has(c.habitId)) return false
    if (typeof c.date !== 'string' || !DATE_RE.test(c.date)) return false
    seenComp.add(c.id)
    return true
  })
  healed.completions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Recompute derived lastCompletedDate from history (cross-device merge fix)
  const latestByHabit = {}
  for (const c of healed.completions) {
    if (!latestByHabit[c.habitId] || c.date >= latestByHabit[c.habitId]) latestByHabit[c.habitId] = c.date
  }
  for (const habit of healed.habits) {
    const derived = latestByHabit[habit.id] || null
    if (habit.lastCompletedDate !== derived) habit.lastCompletedDate = derived
  }

  // ---- board ---------------------------------------------------------------
  // Keep habit rows pointing at existing, non-archived habits; drop legacy
  // task/marker rows (their data stays in `tasks` untouched for rollback).
  const boardHabitIds = new Set()
  healed.board = healed.board.filter(item => {
    if (!item || typeof item !== 'object') return false
    if (item.type === 'habit') {
      const id = item.habitId || item.taskId // tolerate legacy shape once
      if (!id || !habitIds.has(id)) return false
      if (boardHabitIds.has(id)) return false
      boardHabitIds.add(id)
      item.habitId = id
      delete item.taskId
      return true
    }
    return false
  })
  // Every visible habit belongs on the board.
  for (const habit of healed.habits) {
    if (!habit.archived && !boardHabitIds.has(habit.id)) {
      healed.board.push({ type: 'habit', habitId: habit.id })
    }
  }

  // logs capped to prevent unbounded growth
  if (healed.logs.length > 500) {
    healed.logs = healed.logs.slice(healed.logs.length - 500)
  }

  return healed
}

module.exports = { checkSchemaVersion, validateAndHealData }
