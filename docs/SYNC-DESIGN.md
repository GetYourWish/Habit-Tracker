# Sync & Storage Design — habit.json across Desktop and Android

**Status: PROPOSAL — awaiting user approval before Phase 9 (mobile app).**
Scope: how the Electron desktop app (chokidar watcher, direct filesystem)
and the Android app (Expo, Storage Access Framework, no filesystem watcher)
cooperate on ONE `habit.json` shared via Syncthing.

Principles carried over from the monorepo (non-negotiable):

- **Zero drift**: every read/write decision goes through
  `@habit-tracker/core` (`validateAndHealData`, `checkSchemaVersion`,
  scoring). The merge helpers proposed below, if approved, also live in core
  so desktop and Android cannot diverge.
- **No-change-no-write**: an unchanged load must never rewrite the file
  (Phase 2 semantics on both platforms). This is the single most important
  anti-churn rule for a Syncthing folder — every pointless write is a sync
  event, a backup, and a conflict opportunity.
- **Atomic writes**: temp file, then move/replace. Never write in place.
- **Backups**: `.backups/` rolling window of the last 20, created before
  risky operations, identical rules on both platforms.

---

## Platform constraints (Android, addressed in every option)

| Concern | Reality on Android | Design response |
|---|---|---|
| Folder access | No broad filesystem access; Syncthing folders are plain dirs the app cannot freely enumerate | Storage Access Framework: user picks the Syncthing folder once (`ACTION_OPEN_DOCUMENT_TREE`), permission persisted via `takePersistableUriPermission`; paths resolved through `DocumentFile` |
| Change detection | chokidar/inotify do not exist | Poll loop: every ~15 s (matching desktop's `FILE_POLL_INTERVAL_MS`), read `lastModified` + `size` via SAF; if changed, read content and compare a **content hash** (SAF mtimes are not always reliable across sync — the hash is the truth). Only then reload through the core validator and repaint |
| Atomic write | SAF has no true atomic replace; `renameDocument` cannot silently clobber an existing target reliably | Write `habit.json.tmp` document in the SAME directory (so Syncthing sees one rename event), verify the serialized bytes, then `moveDocument(..., replaceTarget)` / delete-target-then-rename; accept a tiny non-atomic window, mitigated by `.backups/` + conflict detection. Never write partial content to the real file |
| Churn | Every rewrite is synced to all peers | Identical no-change-no-write guard as desktop: keep the hash of the last known content; skip the write when the new serialization hashes the same |
| schemaVersion gate | — | Same refusal screen (M3): files with numeric `schemaVersion > 1` are never loaded, never healed |

---

## Option A — Single-writer roles (capability partition)

**Idea:** at any moment each *kind* of change has exactly one writer.
Desktop owns: settings, difficulties, categories, markers, board layout,
task deletion, task text edits. Android owns: creating tasks, completing
tasks, working-on toggles, board reorder of task items (its own local
board), completion notes. Android never deletes data; desktop never writes
completion objects.

**Write path on Android (the "rebase" step):** keep the last-read file
content in memory. Before any write: if the on-disk content changed since
that base, re-apply only Android's additive changes onto the new base —
union of new `logs` (sorted into canonical completedAt order), new task
objects, the affected `task.completion`, the removed board task item —
then write once. This is a narrow, additive merge; it is NOT full
field-level LWW.

- **Data-loss risk: low.** Concurrent desktop+Android edits of the *same*
  field are impossible by construction. Residual risk: desktop edits a
  task's text at the same moment Android completes it → rebase keeps both
  (text from base + completion from Android). Desktop deletes a task
  Android is completing → see edge cases.
- **Cost:** desktop is essentially zero (already behaves this way); Android
  medium (rebase logic + role gating in the UI). The merge helper lives in
  core (~100 lines, fixture-tested) so it can never drift.
- **Feels like:** git with an append-only mobile role. Predictable.

## Option B — Field-level merge with per-field last-writer-wins

**Idea:** both apps write freely; each write carries field timestamps; a
merge engine (in core) reconciles per field: `task.text` (LWW by
`task.updatedAt`), completions (union, LWW per task), arrays (entity-level
union by id + LWW per entity), board order (LWW by file-level timestamp),
settings (LWW per key).

- **Data-loss risk: medium and silent.** "Later" wins per field, so a stale
  device can overwrite a fresh value with an old one after a reconnect;
  delete-vs-edit races resolve silently toward whichever side is "later".
  `meta.updatedAt` is wall-clock and Syncthing explicitly warns against
  clock-based merge decisions.
- **Cost: highest.** Reliable per-field timestamps do not exist in schema 1
  (tasks carry updatedAt only from recent creation writes; completions have
  none). Would require schema additions (per-entity revision counters) →
  schemaVersion 2 → migration logic in core, and older desktop builds
  refuse the file (Phase 2 gate!). Both platforms need full merge UI.
- **Feels like:** building a CRDT-lite. Overkill for a single-user,
  2-device, one-file product.

## Option C — Whole-file last-writer-wins with explicit conflict resolution

**Idea:** both apps write the whole file whenever they have changes. Whoever
writes last wins entirely. Syncthing detects the concurrent writes itself
and preserves the loser as `tracker.sync-conflict-….json`; both apps
surface conflict files (desktop already scans for tracker*-conflict-* via
`check-conflicts`) and offer a resolver UI: compare day scores / recent
completions from both copies (computed by core) and pick one or absorb
missing completions.

- **Data-loss risk: highest for interleaved activity.** Example: complete
  three tasks on the phone while the desktop user reorders the board → the
  later whole-file write erases either the completions or the reorder.
  Recoverable only via the conflict file UI (and `.backups/`), i.e. it
  becomes the user's problem.
- **Cost:** cheapest to build (no merge logic), but the resolver UI is
  mandatory from day one and frequent conflicts train the user to fear the
  feature. No-change-no-write reduces (not eliminates) the collision window.

---

## Edge cases (all options)

1. **Near-midnight completions across timezones.** completedDate is the
   completing device's local date (documented semantics). The same physical
   moment can land on 2026-01-06 on one device and 2026-01-07 on the other.
   That is by design for reviews; the sync layer must not "correct" it.
   The real hazard is the write race around midnight (device A completes at
   23:59:50, device B writes at 00:00:10) — under A/B, A's completion rides
   along because the merge reads the latest base; under C it is lost to a
   conflict file.
2. **Deleted-while-completing.** Desktop deletes task T; phone (with an
   older base) completes T. Option A rebase rule: a completion for a task
   absent from the current base is dropped, its log entry kept (logs are
   denormalized — the score history survives, the board stays clean). This
   mirrors existing healing behavior. Options B/C: task T resurrects as
   completed (B: union; C: last writer's copy contains it or not).
3. **Clock skew.** completedAt values come from the completing device's
   clock; a skewed clock misorders the fatigue multiplier within a day
   (each task's position depends on timestamps). Not a sync-layer bug —
   mitigation is UI (show the chosen date/time in the completion popup,
   allow date override, as desktop already does). Sync decisions must NOT
   use wall-clock LWW for anything (reinforces A; Syncthing's own conflict
   detection is vector-clock based, not wall-clock — safe).
4. **-conflict- files.** Under A: rare (single writer per change class),
   and check-conflicts + a banner + core-computed side-by-side scores
   handle them when they do occur (e.g. Syncthing restart races, two
   desktops). Under C: routine; the resolver UI is load-bearing. In all
   cases: conflict copies are never auto-loaded, never auto-deleted, and
   never healed — they are proposals the user resolves.
5. **The app writes while Syncthing is mid-sync.** The tmp-then-rename
   pattern means peers see either the old or the new file, never a partial
   one. The desktop watcher already ignores .tmp artifacts. Android's
   polling hash check adds a second layer (never acts on a half-visible
   state — hash the full content).

---

## Recommendation

**Option A — capability-partitioned single-writer with the additive rebase
step, plus Option C's explicit -conflict- surfacing as the backstop.**

Rationale: this product is one user with two devices and one file. The
cost/benefit of full field-level merge (B) is not defensible against a rule
that simply says "settings and structure live on desktop; achievements can
be captured from anywhere". The rebase step removes the classic "phone
overwrites desktop's concurrent edit" failure for the narrow class of
writes Android actually performs, and it reuses the existing healing +
conflict-detection machinery. M1 (read-only viewer) needs none of this —
it is the natural first milestone and validates the storage layer before
any write exists.

## Open questions for the user

1. **Android board reordering (M2):** reorder locally and treat the board
   layout as Android-owned-while-open (last reorder wins), or read-only
   board on mobile with desktop owning layout entirely?
2. **Settings on mobile (M3):** view-only settings, or allow Android to
   edit its own subset (theme, week start) with desktop deferring? (Any
   Android settings write widens the rebase logic.)
3. **Task deletion on Android:** strictly desktop-only (recommended), or
   soft-delete (active: false on task) so deletions sync cleanly?
4. **Conflict resolver UI:** banner-only on desktop (current) plus a simple
   "keep mine / take theirs / merge completions" dialog — or defer conflict
   UX until a real conflict occurs in practice?
5. **Polling cadence on Android:** 15 s (parity with desktop) is fine for
   battery with SAF stat calls, but a manual pull-to-refresh on top may be
   preferable. Preference?

**STOP — this document requires user approval before Phase 9 begins.**
