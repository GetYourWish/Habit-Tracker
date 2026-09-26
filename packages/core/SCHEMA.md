# habit.json — Data Schema (schemaVersion 1)

The single source of truth for the on-disk format, written from the
implementation: `packages/core` (`createDefaultData`, `validateAndHealData`,
`checkSchemaVersion`, scoring) and the Electron main process
(`desktop/electron/main.cjs`), which is the only component that touches the
filesystem on desktop.

**Normative rule:** this document describes what the code does today. Any
change to these rules is a **breaking change to the drift contract**: bump
`@habit-tracker/core`'s version, regenerate the golden fixtures
(`packages/core/scripts/generate-expected.cjs`), and update this file in the
same commit. The Android app must produce byte-for-byte comparable scores and
healing output from the same file (see the dual-runtime fixture tests).

---

## File conventions

| Topic | Rule |
|---|---|
| Encoding | UTF-8 JSON |
| Serialization | `JSON.stringify(data, null, 2)` (2-space indent) |
| Writes | Atomic: write `<file>.tmp`, then rename over the target |
| Rewrite guard | Persist only when the serialized output **differs** from the last known content — an unchanged load must never rewrite the file (anti-churn for Syncthing) |
| Backups | `.backups/habit-<timestamp>.json` next to the data file; last 20 kept |
| Dates (calendar) | `YYYY-MM-DD` in the **completing device's local calendar** |
| Dates (instants) | Full ISO 8601 timestamps, e.g. `2026-01-06T10:00:00.000Z` |

---

## Top-level structure

```json
{
  "schemaVersion": 1,
  "meta":    { "createdAt": "...", "updatedAt": "..." },
  "settings":     { ... },
  "difficulties": [ ... ],
  "categories":   [ ... ],
  "markers":      [ ... ],
  "board":        [ ... ],
  "tasks":        [ ... ],
  "workingOn":    [ ... ],
  "logs":         [ ... ]
}
```

The habit model adds three top-level sections (a fresh file from
`createDefaultData()` contains all of them alongside empty legacy sections):

```json
{
  "frequencies": [ ... ],
  "habits":      [ ... ],
  "completions": [ ... ]
}
```

---

## The habit model (frequencies · habits · completions)

### `frequencies[]` — the cadence catalogue

Plain user-editable data (rename, recolor, delete, invent new ones; entries
with `system: true` are reseeded by a fresh install but never overwrite edits).
Each entry: `id`, `key`, `label`, `icon`, `color`, plus a `kind` discriminator:

| `kind` | Extra fields | Due when… |
|---|---|---|
| `daily` | — | every day |
| `weekdays` | `weekdays: [0..6]` (0 = Sunday) | the pinned weekdays |
| `weekly` | `weekdays?` (pins due days), `timesPerPeriod?` | every day of the week unless pinned; goal is per ISO week |
| `every-n` | `interval: N`, `anchorDate?` | every N days from the anchor |
| `every-n-weeks` | `interval: N`, `weekdays?`, `anchorDate?` | in due weeks, on the pinned (or any) days |
| `monthly` | `monthDays?: [1..31]`, `timesPerPeriod?` | all month unless days pinned; goal is per month |
| `yearly` | `anchorDate?` | the anniversary window |

Shared optional fields: `timesPerPeriod` (how many completions "count" per
period — the 2×/3×-per-week style goals), `timesPerDay` (default per-day count
for the cadence), `graceDays` (missed days tolerated before a streak breaks).

### `habits[]`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable id; referenced by `board` entries and `completions` |
| `title`, `icon`, `color` | string | Display; emoji + hex color |
| `frequencyId` | string | → `frequencies[].id` |
| `categoryId` | string \| `null` | → `categories[].id` (soft group tag) |
| `order` | number | Display order seed (the `board` array is the live order) |
| `archived` | boolean | Archived habits keep history, leave Today |
| `timesPerDay` | number (1–12), optional | **Per-habit override** of the frequency's default per-day count — this is how "3× a day" lives on any cadence |
| `timesOfDay` | array, optional | **One entry per occurrence**: a slot key (`morning` \| `afternoon` \| `evening` \| `night`) or `null` (= Anytime). `[ "morning", "evening" ]` = brush after breakfast and before bed. An all-`null` list is equivalent to absent |

Resolution rules (core `resolveTimesOfDay`): invalid keys normalize to `null`;
entries beyond the effective `timesPerDay` are dropped; an all-`null` list
collapses to slotless. The effective per-day count is `habit.timesPerDay` when
present, else `frequency.timesPerDay`, else 1 (`effectiveTimesPerDay`).

### `completions[]`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique |
| `habitId` | string | → `habits[].id` (orphans are dropped by healing) |
| `date` | `YYYY-MM-DD` | Local calendar date of the check-in |
| `slot` | `'morning'` \| `'afternoon'` \| `'evening'` \| `'night'`, optional | Which occurrence this check-in satisfied. Absent = an Anytime check-in: it counts toward totals but satisfies no specific slot |
| `note` | string | Optional |
| `createdAt` | ISO timestamp | When it was recorded |

Healing (idempotent): duplicates by `id`, orphaned `habitId`s and malformed
dates drop the completion; an **unknown `slot` value is dropped but the
completion is kept**. The array sorts by (date, id).

Slot semantics on the Today page: a slot is satisfied when at least one
completion that date carries it; slotless check-ins fill Anytime occurrences
(`perDay − declaredSlots` of them) one tap at a time.

---

### `schemaVersion` — number

- **Must be a number.** Missing, `null`, or a non-number (e.g. `"2"`) is
  treated as `1` (legacy files predate the field).
- If it is a **number greater than 1**, the file was written by a newer app
  and is **REFUSED** — never silently healed downgraded. The desktop main
  process rejects the load (`SCHEMA_VERSION_TOO_NEW:<n>` via IPC) and the
  renderer shows a dedicated "file is from a newer version" screen; the file
  is left untouched. Second clients must show a clear error screen with the
  encountered version.
- `validateAndHealData` stamps `schemaVersion: 1` only when it is missing.

### `meta` — object

| Field | Type | Meaning |
|---|---|---|
| `createdAt` | ISO timestamp | Set once when the file is first created |
| `updatedAt` | ISO timestamp | Bumped by **mutating actions at save time** (task added, task completed, settings changed, …). It is **NOT** bumped by loading/healing — healing is idempotent and must never cause a rewrite by itself. |

Second-client semantics: `updatedAt` is wall-clock of whichever device last
mutated data; it carries no ordering guarantee beyond best effort. Do not use
it for merge decisions.

### `settings` — object

All fields optional at runtime (code falls back per below); `createDefaultData`
writes the defaults in parentheses.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `theme` | `"system" \| "light" \| "dark"` | `"system"` | UI theme; `system` follows OS preference |
| `weekStartsOn` | `0 \| 1` | `1` | 0 = Sunday, 1 = Monday; used by week reviews |
| `heatmapMode` | `"score" \| "count"` | `"score"` | Heatmap cell value: day score vs completed-task count |
| `fatigueIncrement` | number | `0.10` | Per-task fatigue step (see Scoring) |
| `fatigueCap` | number | `3.0` | Upper bound of the fatigue multiplier |
| `multiSelectModifier` | `"ctrl" \| "shift" \| "alt"` | `"ctrl"` | Modifier used for multi-select on the board |
| `consecutiveMarkerMargin` | CSS length string | `"150px"` | Vertical margin between consecutive markers (desktop layout) |
| `flowStateColor` | CSS color string | `"#8b5cf6"` | Highlight color for the "working on" state |
| `appIcon` | `"gradient" \| "ember"` | `"gradient"` | App icon theme |
| `dashboard` | object | `{}` | Map of dashboard card id → `boolean`; a card is visible unless explicitly `false` |

Second-client note: `consecutiveMarkerMargin`, `flowStateColor` and
`dashboard` affect desktop presentation only; mobile may read and preserve
them (write back untouched) but is not required to render them.

### `difficulties` — array

| Field | Type | Meaning |
|---|---|---|
| `id` | string (uuid v4) | Stable identifier |
| `label` | string | Display name ("Easy" … "Very Hard") |
| `score` | number | Base points for tasks completed at this difficulty |
| `color` | CSS color string | UI color |
| `order` | number | Sort position |
| `active` | boolean | Soft-delete flag; inactive entries stay in the file |

Defaults: Easy 1, Medium 2, Hard 3, Very Hard 5.

### `categories` — array

| Field | Type | Meaning |
|---|---|---|
| `id` | string (uuid v4) | Stable identifier |
| `name` | string | Display name |
| `color` | CSS color string | UI color |
| `order` | number | Sort position |
| `active` | boolean | Soft-delete flag |
| `priorityMultiplier` | number | **Undocumented until now.** Multiplies the task's score at completion time; only a numeric value is applied (anything else means `1.0`). Desktop UI creates categories with `1`. Applies in BOTH `calculateTaskScoreBreakdown` and `calculateDayScore`. |

### `markers` — array (marker entities)

| Field | Type | Meaning |
|---|---|---|
| `id` | string (uuid v4) | Referenced by board marker items (`markerId`) |
| `categoryId` | string | The category this marker instantiates on the board |
| `createdAt` / `updatedAt` | ISO timestamps | Bookkeeping |
| `note` | string, optional | Free-text note editable from the board |

### `board` — array (board layout)

Ordered list of items defining what appears on the board and in which order.
Healing guarantees every **active** task has an entry and removes entries
pointing at missing/completed tasks or missing markers.

```json
{ "id": "…", "type": "task",   "taskId": "…" }
{ "id": "…", "type": "marker", "markerId": "…" }
```

- `id` is optional (heal-inserted entries omit it); `type` is required.
- Task items reference `tasks[].id` via `taskId`; marker items reference
  `markers[].id` via `markerId`.
- The `id` fields of the board items themselves are NOT stable identifiers
  for business rules — always resolve through `taskId`/`markerId`.

### `tasks` — array

| Field | Type | Meaning |
|---|---|---|
| `id` | string (uuid v4) | Stable identifier |
| `text` | string | Task text; healing coerces non-strings with `String()` |
| `createdAt` | ISO timestamp | When the task was typed |
| `updatedAt` | ISO timestamp, optional | Written by desktop on create; not otherwise maintained |
| `completion` | object \| `null` | `null`/absent = active task; present = completed |

#### `completion` object

| Field | Type | Meaning |
|---|---|---|
| `completedDate` | `YYYY-MM-DD` | **Local calendar date of the completing device** — this keys day scores, heatmap and reviews. A completion at 23:30 UTC+0 and one at 00:30 the next day in UTC+2 land on different days by design. Second clients MUST derive this from their own local calendar date at completion time, never from UTC. |
| `completedAt` | ISO timestamp | Exact instant; used for **fatigue ordering** (see Scoring) |
| `difficultyId` | string | References `difficulties[].id`; unknown id ⇒ base score 0, label "Unknown" |
| `categoryId` | string \| `null` | Category **assigned at completion time** by the completing client (see derivation below); scoring uses this, NOT the board position |
| `note` | string | Optional completion note |

**Category derivation rule (strict):** a task's category comes ONLY from the
board position at completion time — there must be a marker item directly
above AND a marker item directly below on the board, and the two referenced
marker entities must carry the **same** `categoryId`. Everything else ⇒
`null`. The completing client resolves board marker items through
`markers[].markerId → markers[].categoryId`. Once written, `completion
.categoryId` is frozen; later board rearrangement does not rewrite history.

### `workingOn` — array of task ids

Task ids currently "in progress" (the Working-On feature). Healing drops ids
whose task no longer exists or is already completed. Order is meaningful
(stack order, newest last).

### `logs` — array, capped at 500

Completion audit trail; **every entry is appended by the completing client at
completion time**. Newest entries have the newest timestamps; when the cap is
exceeded the oldest entries are dropped (desktop keeps the newest 500 on both
save and heal).

| Field | Type | Meaning |
|---|---|---|
| `id` | string (uuid v4) | Entry id |
| `timestamp` | ISO timestamp | Completion instant (equals `completedAt`) |
| `taskId` / `taskText` | string | Denormalized copy of the task identity |
| `difficultyLabel` / `difficultyColor` | string | Resolved difficulty display values |
| `categoryName` / `categoryColor` | string \| `null` | Resolved category display values |
| `priorityMultiplier` | number | Category multiplier applied |
| `fatigueMultiplier` | number | Fatigue multiplier applied |
| `basePoints` | number | Difficulty score |
| `finalScore` | number | `round(basePoints × fatigueMultiplier × priorityMultiplier, 2)` |

---

## Scoring (the one formula)

```
fatigueMultiplier(i) = min(1.0 + i × fatigueIncrement, fatigueCap)

task score  = basePoints × fatigueMultiplier(i) × priorityMultiplier
day score   = Σ task scores over the day, tasks ordered by completedAt ascending
```

- `i` is the **0-based position** of the task within its `completedDate`,
  ordered by `completedAt` ascending; ties are broken by **iteration order**
  (stable sort, ES2019+ in every supported runtime).
- `basePoints` is the difficulty's `score` (unknown difficulty ⇒ 0).
- `priorityMultiplier` is the completed category's numeric
  `priorityMultiplier` (default `1.0`).
- Single-task breakdowns (`calculateTaskScoreBreakdown`, used for `logs`)
  count **strictly earlier** completions on the same date to derive `i`;
  with a `completedAt` tie, all tied tasks report the same `i` while the day
  total still advances positions per iteration order. This asymmetry is
  intentional and locked by `habit-cap-day` fixture.
- `calculateDayScore` is **canonical/multiplicative** — it must never be
  reimplemented as an additive accumulator (`+increment` per task), which
  drifts from `1.0 + i×increment` in floating point by ~1e-14 per day. The
  golden fixtures fail on such a divergence.
- Breakdown `finalScore` values are rounded to 2 decimals for display/log
  purposes; **day scores are NOT rounded** — they are exact sums.

## Healing (validateAndHealData) — normative behavior

Healing is **idempotent** and must be identical on every platform. It:

1. Returns `createDefaultData()` for null/missing input.
2. Stamps `schemaVersion: 1` when missing; refuses (caller's job) when > 1.
3. Ensures `meta`, `settings`, `difficulties`, `categories`, `markers`,
   `board`, `tasks` exist (empty structures when missing; a missing `meta`
   gets fresh timestamps — the only place healing may introduce "now").
4. Appends board task items for active tasks missing from the board.
5. Removes board items referencing missing tasks, completed tasks, or
   missing markers (order of remaining items is preserved).
6. Initializes `workingOn`/`logs` to `[]` when missing; caps `logs` at the
   newest 500 entries.
7. Drops `workingOn` ids whose task is missing or completed.
8. Coerces every `tasks[].text` to a string.
9. **Never** touches `meta.updatedAt` or any timestamp that is already
   present — healing a valid file yields a byte-identical serialization.

## Second-client semantics summary (for the Android app)

- `completedDate` = completing device's **local** calendar date.
- Fatigue ordering sorts by `completedAt` ascending; ties break by iteration
  order.
- Category at completion = strict marker-above/marker-below same-id rule
  evaluated against the board layout **at that moment**; stored on the
  completion, never recomputed later.
- Only mutating actions bump `meta.updatedAt`; loads never rewrite the file.
- Identical input file ⇒ identical day scores, breakdowns, healed output —
  proven by the dual-runtime fixture tests (Vitest under Node, Jest under
  jest-expo/Hermes).
