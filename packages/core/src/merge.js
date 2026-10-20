// merge.js — additive rebase for whole-file writers (SYNC-DESIGN Option A).
//
// WHY THIS EXISTS: the desktop app saves whole-file writes and detects
// external changes by polling (up to FILE_POLL_INTERVAL_MS = 15 s of
// latency). A phone check-in that lands in that window is INVISIBLE when
// the desktop user saves — the classic whole-file last-writer-wins clobber
// the design doc rejects ("Option C … the later whole-file write erases
// either the completions or the reorder"). The mobile store already rebases
// by re-reading and replaying its queued MUTATIONS; whole-file writers
// cannot replay functions, so they replay the DIFF instead:
//
//   nextData — what the writer wants on disk now
//   baseData — the last content the writer believed was on disk
//   freshData — what is ACTUALLY on disk now (someone else wrote it)
//
// The merge preserves BOTH sides' additive work:
//  - completions: UNION by id (ids are per-device uuids — collision-free).
//    Ids the writer REMOVED relative to its base are removed from the fresh
//    copy too, so an undo travels across the rebase.
//  - habits / frequencies / categories: union by id — a habit created on
//    the other device survives. For an id present on both sides the
//    writer's object wins (structure is edited deliberately, whole-object
//    at a time; two concurrent structural edits of the same entity are a
//    documented conflict-copy case, not something to guess at).
//  - board: the writer's board, plus fresh habit items whose habitId the
//    writer's board lacks (a phone-created habit keeps its row).
//  - everything else (settings, meta, legacy task sections): writer wins.
//
// PURE: no clock, no I/O, no random. The result is shaped so a subsequent
// validateAndHealData is a no-op (completions in canonical (date, id)
// order, no duplicate references) — healing stays idempotent and the
// no-change-no-write guard keeps working.

function byIdKey(entity) {
  return entity && typeof entity === 'object' && typeof entity.id === 'string' ? entity.id : null
}

function indexById(list) {
  const map = new Map()
  for (const e of Array.isArray(list) ? list : []) {
    const id = byIdKey(e)
    if (id !== null) map.set(id, e)
  }
  return map
}

// Three-way id-keyed merge (the SAME semantics the completions class uses,
// applied to whole-object entities):
//   - writer's entries always survive, in the writer's order (creations and
//     deliberate edits included — the writer's object wins on collision)
//   - fresh entries the writer has never seen (not in the base) are ADDED
//     (the other device created them — an additive union)
//   - fresh entries that WERE in the base but are gone from the writer's
//     data stay DELETED (the writer removed them; a stale remote copy must
//     not resurrect what the user deliberately deleted)
function mergeById(nextList, baseList, freshList) {
  const baseMap = indexById(baseList)
  const seen = new Set()
  const out = []
  for (const e of Array.isArray(nextList) ? nextList : []) {
    const id = byIdKey(e)
    if (id === null) continue
    seen.add(id)
    out.push(e)
  }
  for (const e of Array.isArray(freshList) ? freshList : []) {
    const id = byIdKey(e)
    if (id === null || seen.has(id)) continue
    if (baseMap.has(id)) continue // in our base, gone from next → writer deleted it
    seen.add(id)
    out.push(e)
  }
  return out
}

// Canonical completion order — identical to the healing sort in schema.js,
// so the merged file heals byte-identically on the next load.
function sortCompletions(completions) {
  return [...completions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )
}

function rebaseSaveOntoFresh(nextData, baseData, freshData) {
  if (!freshData || typeof freshData !== 'object') return nextData
  if (!nextData || typeof nextData !== 'object') return nextData

  // ---- completions: union + writer's removals -------------------------------
  const baseIds = new Set(
    (Array.isArray(baseData && baseData.completions) ? baseData.completions : [])
      .map(c => byIdKey(c))
      .filter(id => id !== null)
  )
  const nextCompletions = Array.isArray(nextData.completions) ? nextData.completions : []
  const added = nextCompletions.filter(c => !baseIds.has(byIdKey(c)))
  const nextIds = new Set(nextCompletions.map(c => byIdKey(c)).filter(id => id !== null))
  const removedIds = new Set(
    [...baseIds].filter(id => !nextIds.has(id))
  )
  const freshCompletions = Array.isArray(freshData.completions) ? freshData.completions : []
  const freshKept = freshCompletions.filter(c => {
    const id = byIdKey(c)
    return id === null ? false : !removedIds.has(id)
  })
  const freshIds = new Set(freshKept.map(c => byIdKey(c)))
  const mergedCompletions = [...freshKept]
  for (const c of added) {
    const id = byIdKey(c)
    if (id !== null && !freshIds.has(id)) {
      freshIds.add(id)
      mergedCompletions.push(c)
    }
  }

  // ---- id-keyed sections: three-way merge, writer wins on collision -------
  const habits = mergeById(nextData.habits, baseData && baseData.habits, freshData.habits)
  const frequencies = mergeById(nextData.frequencies, baseData && baseData.frequencies, freshData.frequencies)
  const categories = mergeById(nextData.categories, baseData && baseData.categories, freshData.categories)

  // ---- board: writer's board + fresh habit rows it lacks -------------------
  const nextBoard = Array.isArray(nextData.board) ? nextData.board.filter(i => i && typeof i === 'object') : []
  const nextHabitIdsOnBoard = new Set(
    nextBoard.filter(i => i.type === 'habit' && typeof i.habitId === 'string').map(i => i.habitId)
  )
  const mergedHabitIds = new Set(habits.map(h => byIdKey(h)).filter(id => id !== null))
  const board = [...nextBoard]
  for (const item of Array.isArray(freshData.board) ? freshData.board : []) {
    if (!item || typeof item !== 'object' || item.type !== 'habit') continue
    if (typeof item.habitId !== 'string') continue
    if (nextHabitIdsOnBoard.has(item.habitId)) continue
    if (!mergedHabitIds.has(item.habitId)) continue // habit was deleted by the writer
    nextHabitIdsOnBoard.add(item.habitId)
    board.push(item)
  }

  // ---- assemble: fresh structure for the additive classes, writer for the rest
  const merged = {
    ...nextData,
    frequencies,
    habits,
    categories,
    board,
    completions: sortCompletions(mergedCompletions)
  }
  return merged
}

module.exports = { rebaseSaveOntoFresh }
