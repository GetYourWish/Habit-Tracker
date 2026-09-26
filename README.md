# 🚀 Habit Tracker

A personal local-first **habit tracker** for Windows (plus an Android companion).
Build routines that stick: brushing teeth, jogging, reading before bed — any
recurring habit, as often as you want (once a day, twice a day, every other
day, three times a week…), each occurrence pinned to the part of the day it
belongs to.

---

## 🧠 Core Philosophy

| Principle | Description |
|-----------|-------------|
| 🌱 **Today-first** | The main page is simply *what should be done today* — grouped by Morning / Afternoon / Evening / Night / Anytime |
| ⏰ **Best time of day, per occurrence** | A habit due twice a day picks a time for EACH occurrence (brushing = Morning + Evening); every occurrence gets its own check-in |
| 🔥 **Streaks that respect the rules** | Streaks, goals and consistency are recomputed from the log — change a cadence anytime, history is never rewritten |
| 🏠 **Local-First** | No cloud dependencies, your data stays with you |
| 🔄 **Syncthing Compatible** | Cross-device syncing made easy |
| 💾 **Portable Data** | Single JSON file for ultimate portability |

---

## 🌟 Key Features

### 📋 Today (main page)
- Everything due today, grouped into Morning ☀️ / Afternoon / Evening 🌆 / Night 🌙 / Anytime ⏰ sections
- A habit due multiple times a day shows **one row per occurrence** — each with its own check circle (tap to check, tap again to undo)
- Habits without preferred times live in Anytime with a ×N progress chip — every tap adds one check-in
- Day progress ring, streak flames 🔥, last-7-days dot grid per row
- "Resting today" section for habits not scheduled today (bonus check-ins allowed)

### ✏️ Habit Editor — times per day + best time of day
- Pick an emoji, a color, a group (Body / Mind / Home / Work — yours to rename)
- Cadence chips: Every day, Weekdays, Weekends, Every other day, Once/Twice/Three times a week, Monthly, Yearly…
- **Times per day stepper (1–12)** — and when it's more than once, **one best-time-of-day choice per occurrence**: Morning / Afternoon / Evening / Night / Anytime each
- Sensible defaults (2× suggests Morning + Evening), freely changeable per occurrence, live preview line

### 🗂 Habits management
- All habits grouped by group chips; reorder, archive (keeps history), delete (with confirmation)
- Group manager: add / rename / recolor / delete groups
- Streak + best streak + cadence summary on every row

### 📊 Reviews
- 30 / 90-day views: check-ins in range, best live streak, perfect days, active days
- Per-habit dot grids (darker = more check-ins), current & best streak, total, consistency %

### ⚙️ Settings
- Data file location, backup now, auto-sync watching, Syncthing conflict surfacing
- Theme (Light / Dark / System), week start day

### 💾 Data model highlights
- Habits carry `timesPerDay` (1–12) and `timesOfDay` — one slot (or Anytime) per occurrence
- Completions record which slot they satisfied (`completion.slot`)
- Healing is idempotent and never rewrites unchanged content; unknown slot values are dropped without losing the completion
- Full schema: [`packages/core/SCHEMA.md`](packages/core/SCHEMA.md)

---

## 🔧 Technical Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 19 + Vite |
| **Desktop Framework** | Electron (Node.js) |
| **Date Utilities** | `date-fns` |
| **File Watching** | Chokidar |
| **Styling** | Custom CSS (no heavy frameworks) |

> Dev note: `desktop/dev-preview.html` serves the full UI in a plain browser
> (vite dev server) with a localStorage-backed mock of the Electron API —
> handy for quick UI work without launching Electron.

> The `mobile/` workspace still shows the legacy task board UI; it reads and
> preserves the same `habit.json` safely (same core healing/gate) but hasn't
> been redesigned around habits yet.

---

## 💾 Data Storage

All your data lives in a single JSON file (`habit.json` by default).

### Default Location
- Primary: `SyncThis/habit.json` next to the executable
- Fallback: `Documents/PerformanceTracker/SyncThis/habit.json`

### JSON Structure
The complete, normative field-by-field format lives in
**[`packages/core/SCHEMA.md`](packages/core/SCHEMA.md)** — the schema
contract shared by the desktop app and the Android app. Quick outline:

```json
{
  "schemaVersion": 1,
  "meta": { "createdAt": "…", "updatedAt": "…" },
  "settings": { ... },
  "frequencies": [ { "id": "…", "key": "daily", "label": "Every day", "kind": "daily", "timesPerPeriod": 1, "graceDays": 0 } ],
  "categories": [ ... ],
  "habits": [
    {
      "id": "…", "title": "Brush teeth", "icon": "🪥", "color": "#2dd4bf",
      "frequencyId": "…", "categoryId": "…", "order": 0, "archived": false,
      "timesPerDay": 2,
      "timesOfDay": ["morning", "evening"]
    }
  ],
  "board": [ { "type": "habit", "habitId": "…" } ],
  "completions": [ { "id": "…", "habitId": "…", "date": "2026-09-27", "slot": "morning", "note": "" } ],
  "logs": [ ... ],
  "tasks": [ ], "workingOn": [ ], "difficulties": [ ], "markers": [ ]
}
```

### 🔁 Syncthing Compatibility
The app is designed to work seamlessly with Syncthing:
- **Automatic File Watching**: `chokidar` detects external changes made by Syncthing
- **Atomic Writes**: Safe "write-temp-then-rename" pattern prevents data corruption
- **Automatic Backups**: Keeps the last 20 backups before risky operations
- **Conflict Detection**: Automatically detects and handles `-conflict-` files generated by Syncthing

---

## 📱 Android App

The `mobile/` workspace is an Expo / React Native app that reads and writes the
**same `habit.json`** through the same `@habit-tracker/core` — identical
scores, identical healing, identical schema gate. Android-native UX (Material
ripples, bottom navigation, FAB, edge-to-edge) on the desktop app's aurora-glass
theme.

- **Storage**: the folder is picked once via Android's Storage Access Framework
  (your Syncthing folder — no broad storage permission); permission can be
  re-granted from the setup screen if Android revokes it
- **Writes**: rebased on the freshest file before every save, skipped when
  content is unchanged, written to a verified temp document first, with a
  rolling backup window (20) in the app's private storage
- **Sync detection**: 15-second polling (same cadence as the desktop watcher),
  an immediate check when the app returns to the foreground, and
  pull-to-refresh. This avoids showing stale data after Android suspended the
  app while Syncthing updated the shared folder.
- **Conflicts**: Syncthing `-conflict-` copies are surfaced on the board and in
  Settings — never auto-loaded, never auto-deleted

#### v1.0.7 build fix — `jserrorhandler/ErrorUtils.h` not found (2026-09-19)

**Symptom (remote-reported):** the mandatory v1.0.7 rebuild
(`git pull` → `npm install` → `clean:native` → `gradlew assembleRelease`)
fails at:

```
Task :expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
.../react-android-0.87.1-release/prefab/modules/reactnative/include/cxxreact/ErrorUtils.h:12:10:
fatal error: 'jserrorhandler/ErrorUtils.h' file not found
```

**Root cause (a latent trap that v1.0.7's dependency cleanup sprung):**

1. react-native 0.87 moved `ErrorUtils` to `ReactCommon/jserrorhandler/` and
   left a deprecation shim at `cxxreact/ErrorUtils.h` that only does
   `#include <jserrorhandler/ErrorUtils.h>`. The shim **is** packaged into the
   `react-android` prefab — but the `jserrorhandler/` headers it redirects to
   are **not** (checked against `ReactAndroid/build.gradle.kts`'s prefab copy
   list: cxxreact/, react/**, jsi/, yoga/ … no jserrorhandler). There is no
   `ReactAndroid::jserrorhandler` prefab target to link either.
2. `expo-modules-core` still compiles `EventEmitter.cpp` with
   `#include <cxxreact/ErrorUtils.h>` (so does current upstream `main`), and
   only puts `${REACT_NATIVE_DIR}/ReactCommon` — the one directory on disk
   that actually contains `jserrorhandler/ErrorUtils.h` — on the include path
   **when react-native-worklets is installed** (`cmake/main.cmake`:
   `if (REACT_NATIVE_WORKLETS_DIR)`). Upstream Expo never noticed because
   their default template ships reanimated+worklets, so the include path is
   almost always present in the wild.
3. Every previous build of this app had worklets installed, so the include
   path was there. v1.0.7 **removed worklets** → the next full native
   recompile (worklets' absence changes expo's cmake arguments → new `.cxx`
   configure → everything recompiles) hit the unresolvable shim.

**Fix:** `plugins/patch-expo-reactcommon-include.js` adds
`${REACT_NATIVE_DIR}/ReactCommon` to `EXPO_COMMON` (the interface library
both `expo-modules-core` and `expo-modules-jsi` consume) — exactly what the
worklets-conditional block used to provide, now unconditional. It runs from
npm `postinstall`, from `prebuild` (`with-expo-reactcommon-include`), and from
`clean:native` (which now also wipes `expo-modules-core`'s `.cxx`).
Idempotent and anchored like the other patchers; if a future
`expo-modules-core` ships its own fix, it becomes a logged no-op.

**Verified end-to-end before shipping:** all 58 C++ translation units of
`expo-modules-core@57.0.14` were compiled with the exact failing build's
flags (NDK r27b / `27.1.12297006`, arm64-v8a, RelWithDebInfo) against a
prefab include tree rebuilt from `react-native@0.87.1`'s own copy list:
without the fix 57/58 compile and `EventEmitter.cpp` fails with the exact
reported error; with the fix **58/58 compile clean**. A recursive include
audit of every other native dependency confirmed nothing else was depending
on the worklets-gated include path (`safe-area-context` builds app-side with
RN's own application cmake; async-storage/expo-file-system/expo-linear-gradient
ship no Android C++).

**Rebuilding after this fix (no `clean:native` needed — no dependency
changes, `npm install` re-applies the patch to `node_modules`):**

```
git pull
npm install
cd mobile\android
.\gradlew assembleRelease
```

(The patched `common.cmake` is picked up automatically: cmake re-runs because
the file changed, then recompiles `expo-modules-core` with the new include
path. If the build still behaves oddly, `npm run clean:native` now also wipes
`expo-modules-core`'s stale `.cxx`.)

#### v1.0.11 — the broken teleport, solid background, light theme, real Flow chart + consecutive marker spacing

**Symptoms (2026-09-23, remote-reported):** *"category teleport did not work,
maybe the Board code doesnt have something that understands the solution you
provided ? also i would like to fix some UI, starting with the simple Board
background, i want it to be a solid whole color following current theme. also
talking about themes, im gonna neeed you to fix the Light theme, it doesn't
work correctly the letters are not right. one more thing, the flow in Reviews
shows a bar chart instead of having the actual flow we have in the desktop
version for example.. lastly make use that the Consecutive marker spacing is
working correctly in this android version because it seems like it aint"* —
five reports, five root causes, all fixed:

1. **Category teleport — the v1.0.10 implementation could not work on
   device.** Two independent bugs: (a) the per-row `onLayout` offset capture
   recorded each row's `y` **relative to the FlatList's cell wrapper**
   (always ~0), so the "measured" scroll always went to the board top; (b)
   the `scrollToIndex` fallback for rows the virtualizer never rendered
   **throws an invariant in RN 0.87** when no `onScrollToIndexFailed`
   handler exists — the surrounding try/catch silently ate it, so far rows
   did nothing at all. Rewritten: rows are now measured through refs +
   `measureInWindow` (window coordinates converted to content offsets with
   the tracked scroll offset, wrappers `collapsable={false}` so Android
   keeps them measurable) and the FlatList carries a real
   `onScrollToIndexFailed` handler that lands near the target using RN's own
   average-cell-length estimate, then precisely re-centers it once rendered
   (loop-guarded, timers cleaned up on unmount). Both the dice and the
   category teleport ride the same path.

2. **Solid board background.** The aurora canvas (a `LinearGradient` plus
   three hard-edged blob circles — the desktop fades them with radial
   gradients, the mobile port rendered solid discs) is now ONE solid color
   per theme: `#EEF2FF` on light, `#0B0D12` on dark (`theme.bgCanvas`,
   guarded by `themeColorGuard`). `expo-linear-gradient` is no longer
   imported anywhere; the dependency stays only so the native build is
   untouched.

3. **Light theme letters.** The app never rendered a `<StatusBar>`, so with
   edge-to-edge the system letters (clock, battery, notification icons)
   kept the system-dark `light-content` style — white letters on the
   near-white light canvas. The status bar now follows the APP theme
   (`dark-content` in light, `light-content` in dark, on every screen
   including loading/setup/error).

4. **Flow State — the actual desktop flow.** The Flow tab rendered plain
   bars; the desktop's *ChronoStream* is a smooth monotone **area** chart.
   Ported with zero new dependencies: the per-day scores are interpolated
   with a Fritsch–Carlson monotone cubic (the same family as recharts'
   `type="monotone"`, proven non-overshooting by tests) into ~100
   contiguous micro-column Views tinted at the desktop's 0.4 fill opacity,
   a solid 2dp top edge traces the curve, future days leave their slots
   empty exactly like `connectNulls={false}`, and every day with
   completions carries a tappable dot (the desktop's clickable r=6 dots) —
   week view adds weekday labels and per-dot scores, longer ranges thin to
   short dates and bucket to ≤120 points keeping each bucket's peak day.

5. **Consecutive marker spacing.** `Settings → Board → marker spacing`
   wrote `consecutiveMarkerMargin` all along, but the board never READ it —
   markers sat tight together no matter what. The desktop rule is now
   applied verbatim: a marker whose previous VISIBLE board item is also a
   marker gets `marginTop` = the parsed margin (default 150px, capped at
   500 like the Settings input; garbage values fall back to 150).

**Verification:** mobile jest **358/358** (19 new: flow-chart suite —
sampler endpoints/monotonicity/geometry/bucketing/dots, teleport wiring —
`onScrollToIndexFailed` present, far-index failure never throws or loops,
`collapsable={false}` wrappers, consecutive-spacing 4-pack), core 42/42,
desktop 6/6, root eslint clean, core-pin guard OK, metro bundle export OK
(2.2 MB). Desktop and core workspaces untouched (mobile/ + README.md only).
**Rebuild:** `git pull` → `npm install` → `cd mobile/android` →
`gradlew assembleRelease` (no `clean:native` needed) — the loading screen
must show **v1.0.11**.

#### v1.0.10 — the missing Randomizer, category teleport + Working On popup (desktop feature parity)

**Symptoms (2026-09-22, remote-reported):** *"some few features we need to
add are the working on pop up that is missing, the ability to click on a
category in the categories section and have it teleport us to it at the
board. the randomizer button is also missing from the app because i see no
dice button that picks a task as working on"* — three desktop features the
mobile board never had, all ported:

1. **Dice / Randomizer.** The desktop's `Randomizer` button
   (`Board.handleRandomizeTask`) is now the dice button in the board's top
   app bar. It picks a random task from the board — preferring ones NOT
   already being worked on — writes it into `workingOn` through the new
   `addWorkingOn` action (the exact desktop write; when every task is
   already being worked on the write is skipped entirely, like the desktop
   skipping `onSave`), then teleports the list to that row and flashes it
   with the same amber highlight as the desktop's `.random-flash` keyframe.
   Empty board → a hint snackbar instead of a silent no-op.

2. **Category teleport.** Tapping a category in the Categories sheet now
   JUMPS to its first marker on the board (desktop chip click →
   `handleNavigateToCategory` → `scrollIntoView` + flash) — the sheet
   closes, the list scrolls the marker to mid-viewport and flashes it. The
   "+" icon next to each category keeps the old behavior (place a marker at
   the end of the board), matching the desktop chip's `+` button. A category
   with no marker on the board gets a *"No 'X' marker on the board yet"*
   hint instead of silence. Exact row offsets come from per-row `onLayout`
   capture, with a `scrollToIndex` fallback for rows never laid out.

3. **Working On popup.** The desktop's nav `Working On (N)` marker button +
   `WorkingOnPopup` are now the tappable **Working On** pill on the board's
   today card (shown only when something is being worked on, like the
   desktop hiding the marker at 0). It opens a bottom sheet listing every
   working-on task — category color dot + tinted row background (desktop
   `${category.color}22` tint, categories derived with the same strict
   marker rule) — and tapping a task completes it right there through the
   SAME `CompleteDialog` and `completeTask` action as a board row: identical
   scoring, log entry, board removal and `workingOn` cleanup, through the
   same verified write cycle. Completing closes the whole stack (desktop
   parity); cancel returns to the list. The desktop popup's *Export Image*
   button is Electron-only (html-to-image + native save dialog) and is
   intentionally not ported.

4. **Two hardening fixes found while testing.** (a) The Settings
   dashboard-card visibility switches rendered `check-box-outline` — not a
   real material-community name (the real one is `checkbox-outline`) — so
   the checked state showed a missing-glyph box; fixed, and a new
   `icon-names.test.js` static audit now validates EVERY icon name in the
   app against the glyphmap so this blank-glyph class of bug can never ship
   again. (b) The icon-font embedder's `copyFileSync` ran unconditionally —
   every `npm install` / prebuild rewrote the APK-embedded TTF for nothing,
   and its "is idempotent" test only passed when both writes happened to
   land inside one filesystem mtime tick (a timing flake that surfaced
   under parallel-suite load). The embedder now skips the rewrite when the
   identical font is already embedded (size + content compare) — same
   behavior for both the postinstall and prebuild paths.

**Rebuild:** same as v1.0.9 — `git pull`, `npm install`, then
`cd mobile/android && ./gradlew assembleRelease`. No prebuild changes were
made; the loading screen should show **v1.0.10**.

#### v1.0.9 — the blank-icons + missing-Reviews/Appearance fix (full desktop UI parity)

**Symptoms (2026-09-22, remote-reported):** *"in the android app there is
blank spaces in the places of actual icons… there is even missing settings
specifically the appearance section and the reviews section is non existent.
i think in the board there is the button but i cant see them since when
fiddling around i ended up clicking something"* — four defects, all fixed:

1. **Blank icons + invisible board buttons (one root cause).** Every icon in
   the app renders through `@expo/vector-icons`, whose TTF lives in a metro
   asset. In this monorepo the package is hoisted to the workspace-root
   `node_modules` — OUTSIDE `mobile/` — so the RN CLI writes the font into
   `res/raw` under a mangled `_node_modules_…` name, and expo-font must then
   resolve the asset, look the resource up by identifier, copy it to the
   cache dir and call `Typeface.createFromFile` before ReactFontManager can
   use it. Five links, any of which can silently fail on a given device —
   and when one does, the Icon component renders an **empty Text forever**:
   blank spots where icons should be, and icon-only board controls (the
   per-task action buttons) become *invisible but still tappable* — exactly
   the "I clicked something I couldn't see" report. **Fix:** the
   MaterialCommunityIcons TTF is now embedded straight into the APK at
   `android/app/src/main/assets/fonts/material-community.ttf` (named after
   the RN font family). Android's `ReactFontManager` loads
   `assets/fonts/<family>.ttf` natively with **zero runtime loading code** —
   the fragile chain is simply not on the path anymore. Wired two ways so
   nobody has to re-run prebuild: `plugins/with-icon-font.js` (prebuild
   plugin) and `plugins/embed-icon-font.js` (npm postinstall — repairs an
   existing/stale `android/` folder on `npm install`). The
   `verifyStandaloneApk` build task now also **fails the build** if an APK
   ships without the font (same treatment as the JS bundle check).

2. **The Reviews section is no longer missing.** The desktop's Reviews view
   — five tabs: **Dashboard | Daily | Flow State | Stacked | Heatmap** —
   now exists on Android (`ReviewsScreen` + `reviews/charts.js` +
   `reviews/dashboard.js`, a new **Reviews** tab in the bottom nav). The
   Dashboard tab is the desktop's Performance Cockpit with the same four
   panels (INTENSITY / RECORDS / RHYTHM / COMPOSITION) and the same 20
   card-visibility ids; Daily/Flow/Stacked/Heatmap render the same series
   and the same day-score numbers (every figure comes from
   `@habit-tracker/core` over the same habit.json). Editing parity
   with the desktop's TaskDetailPopup: tap any completion to edit its note,
   completion time or completion date (the "worked past midnight"
   correction) or delete it — every edit goes through the same
   `store.mutate` → rebase → verify write cycle as a board edit and syncs
   to the desktop. Charts are plain RN Views (no new native dependency),
   and the date math lives in `src/dates.js` on core's device-local
   calendar convention.

3. **Settings now has full desktop parity.** The desktop's settings tabs
   all exist as sections: **Difficulties** (add / rename / re-score /
   reorder / recolor / deactivate), **Categories** (same, plus priority
   multipliers), **Appearance** (theme + Flow State color picker +
   consecutive marker spacing), **Calendar** (week start), **Scoring**
   (fatigue controls + heatmap mode), **Logs** (filter All / Today / This
   Week, per-entry score breakdown, clear) and **Dashboard Cards**
   (visibility toggles shared with the desktop through
   `settings.dashboard`). Desktop-only controls (keyboard multi-select,
   window app-icon picker) are deliberately not mirrored.

4. **Two latent port bugs caught by the new test suite before release.**
   The Reviews tab bar initially used `{ key: … }` option objects where the
   `Segmented` control reads `opt.value` — every tab tap would have called
   `onChange(undefined)` and silently landed on the Heatmap; and three
   `getStartOfWeek` call sites passed date-fns's `{ weekStartsOn }` options
   object where core's API takes the bare number — both fixed and pinned by
   tests (`reviews-screen.test.js`).

Also in this release: a version bump to **1.0.9 (versionCode 10)** — check
the loading screen says v1.0.9 after installing.

**Rebuilding (no `clean:native` needed — no dependency changes; `npm
install` embeds the icon font into the existing `android/` folder via
postinstall):**

```
git pull
npm install
cd mobile\android
.\gradlew assembleRelease
```

Mobile jest 298/298 (48 new: the icon-font embedder + wiring, the
verify-task font assertion, Reviews tabs/dialogs/charts/heatmap parity,
completion-edit actions, difficulty/category/log actions), core vitest
42/42, desktop 6/6, storage format-lock 44/44 (habit.json stays
byte-identical to the desktop's atomicSave format), eslint 0 errors, metro
export OK (2.2 MB).

#### v1.0.8 — the 'every action corrupts habit.json' fix (truncation-proof SAF writes)

**Symptoms (2026-09-21, remote-reported, screenshot-confirmed):** *"whenever
i do something in the app like changing the theme or adding a new task it
just crashes and gives that screen"* —

```
Could not load habit.json
Corrupt JSON: JSON Parse error: Unexpected character: }
```

— and **Restore latest backup worked, but the very next action corrupted the
file again**. Device timestamps sealed the diagnosis: the pre-write backup
rotated at `19:00:26.474` and the corrupt state painted at `19:00:26.854` —
the damage was produced by the write cycle itself, in ~380 ms, on a build
that already contained the v1.0.6 write serialization. Overlapping writes
were never the (whole) story.

**Root cause — the provider does not truncate an EXISTING document.**
expo's legacy `writeAsStringAsync` opens a SAF document with
`openOutputStream(uri, "w")` — a mode whose truncation of an *existing*
document is provider-dependent. On the affected device the new bytes land
from offset 0 and, when the new content is SHORTER than the old, the
previous content's tail bytes stay on disk after the write. habit.json is
pretty-printed JSON whose final byte is `}`, so a 1–2 byte shrink (theme
`system` → `dark`) leaves a stray `}` after the complete new document —
precisely *"Unexpected character: }"*. The tmp sibling always verified
because it is created FRESH every cycle (no old bytes to leave behind), and
"Restore latest backup" always worked because a restore rewrites the file
with content at least as long as the damaged one — which is what made the
loop look so confounding.

**Fixes shipped (four layers, so no provider quirk can reach the user):**

1. **Truncating writes at the native layer** —
   `plugins/patch-expo-saf-truncate.js` (postinstall + prebuild plugin, same
   wiring as the fd-leak patch) rewrites expo's open to `"rwt"`, the
   `openOutputStream` mode that explicitly carries `MODE_TRUNCATE`, with a
   fallback to `"w"` for any provider that rejects it.
2. **In-cycle verify-and-recreate repair** — if the byte-verified target
   write STILL comes back wrong, `store.writeData` recreates habit.json as
   a fresh document (create + write + verify — the exact sequence that just
   succeeded for the tmp sibling) inside the same cycle. The user never sees
   the recovery screen, even on a provider that mangles in-place overwrites.
   A SAF name-collision guard (`tracker (1).json` dedupe) makes a half-done
   repair structurally impossible.
3. **Transient-damage settle** — Syncthing pulls file blocks straight into
   the destination file, so a read landing mid-sync observes garbage for a
   moment. Loads, rebases and post-write inspections now re-read with a
   short settle delay before declaring corruption; a mid-sync rebase heals
   transparently, mutation included. Only damage that persists across the
   retries opens the recovery flow.
4. **Recovery sources re-listed** — after a failed write cycle the recovery
   screen now actually offers **Restore last verified copy** (the tmp
   sibling); the folder listing it consulted used to predate the tmp the
   failing cycle had just created, so the most trustworthy recovery source
   was invisible exactly when it existed.

Also in this release: a same-name-collision guard on the initial target
create, and a version bump to **1.0.8 (versionCode 9)** — check the loading
screen says v1.0.8 after installing.

**Rebuilding (no `clean:native` needed — no dependency changes; `npm
install` re-applies the patch to `node_modules`):**

```
git pull
npm install
cd mobile\android
.\gradlew assembleRelease
```

Mobile jest 250/250 (14 new: the patch transform + wiring, the
non-truncating-provider repair, mid-sync settle for loads and rebases,
persistent-corruption recovery sources, and the dedupe guard), core vitest
42/42, desktop 6/6, core-pin guard OK, eslint 0 errors, metro export OK
(2.1 MB).

#### v1.0.7 — the crash-proofing + UI repair release

**Symptoms (2026-09-18, remote-reported):** after salvaging a corrupt file,
*"i cant create a new task without having it crash, i cant change the theme
without having it crash"* — and *"the text doesnt look well enough"*.

Four separate defects, all fixed:

1. **Render errors killed the app (release builds have no error boundary).**
   Any component throwing during render unmounts the whole tree and the
   process dies — the store's data guarantees hold, but the user sees a total
   crash. Every screen is now wrapped in an `ErrorBoundary`
   (`src/components/ErrorBoundary.js`): a render error shows a calm in-app
   card ("your data file was NOT touched") with **Try again** and, after a
   failed retry, **Reload data from disk**. Whatever the error is, it can no
   longer take the app down with it.

2. **The invisible controls (the "text" complaint).** `theme.flowState` /
   `flowStatePressed` / `danger` were **never defined** on the theme objects,
   so the FAB rendered with *no background at all*, filled buttons (Complete,
   New category, Reload from disk) were *transparent with white labels*, and
   text buttons (Cancel/Save/Change/Backup) fell back to the system default
   color — near-black, unreadable in dark mode. Both themes now carry the full
   control-color set, and `themeColorGuard()` pins it forever
   (`ui-hardening.test.js`).

3. **The drag-and-drop library was removed.** `react-native-draggable-flatlist`
   4.0.3 (last release: 2023, built for reanimated 2/3) was running on React
   19.2 + reanimated 4.6 + RN 0.87 — an unsupported combination with open
   crash issues (#496/#524/#558) and the prime suspect for the
   create-a-task crash. The board now reorders exactly like the desktop:
   **tap the ⋮⋮ handle on any row → move with ↑/↓ → tap ✓ when done.**
   `react-native-reanimated`, `react-native-worklets` and
   `react-native-gesture-handler` are gone from the dependency list entirely
   (the release bundle dropped from 3.3 MB to 2.1 MB), and `package-contract.test.js`
   pins their absence.

4. **Device-parity bug in the private backup window.** Android's legacy
   `readDirectoryAsync` returns bare file *names*, but the store treated
   listings as URIs — on real devices backup pruning and
   **Restore latest backup** silently failed ("Location … isn't deletable").
   `saf.js` now normalizes listings to full URIs, with a regression test that
   feeds the bare-name shape straight into the real adapter.

Also in this release: **theme changes apply instantly** (optimistic override —
the old build showed zero feedback for the entire 1–2 s SAF write cycle, which
read exactly like "it stopped making changes"), and the 15-second sync poll
**no longer flashes the full-screen loading spinner** over a healthy board
when Syncthing lands a desktop edit (quiet reload, tested).

**Rebuilding (v1.0.7 — `clean:native` is MANDATORY, dependencies changed):**

```
git pull
npm install
npm run clean:native --workspace @habit-tracker/mobile
cd mobile\android
.\gradlew assembleRelease
```

After installing, verify: the loading screen says **v1.0.7**; Settings → About
says **v1.0.7 (js bundle)**; the FAB is a purple pill; dialog buttons are
readable in dark mode.

#### v1.0.6 — the corrupt habit.json fix (data-loss class) + built-in recovery

**Symptom (2026-09-17, remote-reported):** fiddling with the theme in Settings
worked at first, then changes silently stopped applying; after restarting the
app:

```
Could not load habit.json
Corrupt JSON: JSON Parse error: Unexpected character: s
```

**Root cause — the app corrupted its own file with overlapping writes.**
expo's legacy `writeAsStringAsync` (verified in
`expo-file-system/…/legacy/FileSystemLegacyModule.kt`) implements a SAF
document write as `contentResolver.openOutputStream(uri, "w")` — which
**truncates the document at open** — and then streams the string through an
`OutputStreamWriter` in 8 KB chunks **on its own coroutine**. Meanwhile the
store's `mutate()` had *no serialization between concurrent calls*: every
theme tap launched a full rebase → tmp-write → verify → target-write
pipeline, and two pipelines in flight meant two truncating, chunked writes
interleaving inside the document provider → a structurally broken file.
The very next mutation's rebase then failed to parse the damaged file, so
every further change errored out ("it stopped making any changes"), and the
restart showed the parse error above.

Two aggravating gaps turned a corruption into a near-loss:
- backups only rotated when overwriting an **external** change — a
  self-inflicted corruption left **no recovery point at all**;
- the corrupt-file screen was a dead end (error text, no way forward).

**Fixes shipped (all four layers):**
1. **Write serialization** — all storage access now goes through a
   readers-writer lock (loads may share; writes are exclusive against
   everything, write-preferring). Two overlapping writes from this app are
   structurally impossible now.
2. **Mutation batching** — mutations queued while a batch writes (theme
   fiddling, quick edits) are composed in order and written in **one**
   verified cycle. One disk write per burst instead of a racing write per tap.
3. **Backup before EVERY real write** — the current on-disk content is
   copied into the app-private rolling `.backups/` window (20) before each
   write, no matter who wrote those bytes. A damaged write can never be the
   last copy of anything.
4. **Corrupt-file recovery screen** — the damaged bytes are preserved
   verbatim in the app-private `.corrupt/` window (10) *before anything
   else happens*, then the error screen offers, in order of trust:
   - **Restore last verified copy** — the `.tracker.tmp.json` sibling
     (byte-verified content of an interrupted write cycle),
   - **Restore latest backup** — from the pre-write backup window,
   - **Salvage readable data** — a structural salvager
     (`mobile/src/storage/salvage.js`) that keeps every complete value and
     drops only the damaged seam; the result re-runs the same schema gate +
     heal as a normal load,
   - **Try loading again** — after a manual/sync-software repair.
   Saves onto a damaged file are refused (`CORRUPT_FILE`) with a clear
   message instead of silently erroring per tap.

**If your habit.json is already damaged:** install v1.0.6, open the app,
and use **Salvage readable data** on the recovery screen (earlier builds
made no backup of local writes, so salvage is usually the only in-app
source). The damaged original is preserved untouched in the app's private
storage — and if you also run the desktop, check Syncthing's versioning on
the desktop side before salvaging.

Version 1.0.6 / versionCode 7. Mobile jest 196/196 (the concurrency model,
pre-write backups and all three recovery paths were additionally verified
out-of-tree against instrumented adapters — concurrent mutations now provably
never overlap an adapter write op), core vitest 42/42, core-pin guard OK,
eslint 0 errors, metro export OK.

#### v1.0.5 — the board crash fix ("Element type is invalid") + REGENERATE YOUR ANDROID FOLDER

**Symptom (2026-09-17 crash report, captured by the on-device crash logger):**
the app finally got past "Loading…" — and then crashed the moment the board
should have appeared:

```
JavascriptException: Error: Element type is invalid: expected a string
(for built-in components) or a class/function (for composite components)
but got: undefined.
    at RCTView → at View → at BoardScreen → …
```

**Root cause 1 — the crash itself.** `react-native-draggable-flatlist` v4
exports the list component as the **default export only**
(`export default DraggableFlatList`); `ScaleDecorator` & friends are the named
exports. `BoardScreen.js` imported it as a *named* binding
(`import { DraggableFlatList, … }`) — which compiles, bundles and passes every
test, but is `undefined` at runtime. The very first board render on a real
device died. Nobody ever saw it before because **no build had ever reached the
board** — every earlier build was stuck on "Loading…" (the v1.0.4 store bug).
The jest mocks had *invented* a named `DraggableFlatList` export, so the full
-boot board tests passed while the app crashed (the same "mock mirrors the
app's wrong assumption" failure class as the v1.0.3 SAF arg-order bug).

**Root cause 2 — a second latent crash found by the follow-up audit.**
`CategorySheet.js` rendered `<TextInput>` without importing it — the first
"New category" tap would have crashed the freshly-fixed board with the same
error. A full JSX-binding audit of every app file found (and fixed) it.

Fixes shipped:
- `BoardScreen.js` — `import DraggableFlatList, { ScaleDecorator } …` (default import)
- `CategorySheet.js` — `TextInput` added to the react-native import list
- jest mocks now mirror the REAL package export shape (`__esModule: true` +
  `default` + `ScaleDecorator`) — a regression back to a named import now
  fails the board render tests in CI
- new permanent guards: `__tests__/package-contract.test.js` (pins the real
  installed package's export shape + BoardScreen's import form),
  `__tests__/jsx-bindings.test.js` (static audit: every JSX tag in the app
  must resolve to a declared binding), `__tests__/category-sheet.test.js`
  (opens the create-category form for real)
- the JS crash report and Settings→About now show the **bundled app.json
  version** (see below for why that matters)

**Why your crash report said "app version: 1.0.1" while running 1.0.4 code —
IMPORTANT for every future rebuild.** `gradlew assembleRelease` rebuilds the
**JS bundle** from source but does **not** regenerate the android project:
`versionName`, `versionCode` and the release **permissions overlay** are
synced from `app.json` only by `expo prebuild`. Your `mobile/android` folder
was generated while app.json still said 1.0.1, so every APK since silently:
- reported versionName 1.0.1 in native crash reports (the JS *loading screens*
  showed the true v1.0.4 — both were right about different halves of the apk), and
- still contained INTERNET & co., because the v1.0.4
  `with-release-permissions` overlay had never been written into that folder.

**Rebuilding (v1.0.5 — the android folder MUST be regenerated this time):**

```bash
git pull
npm install                                  # postinstall patches (unchanged)
npm run clean:native --workspace @habit-tracker/mobile   # regenerates android/ from app.json
cd mobile/android
.\gradlew assembleRelease                    # Windows
```

`clean:native` wipes and regenerates `mobile/android` (the .cxx native
rebuild is the cost — grab a coffee). After installing the APK (versionCode
6), verify the sync worked:

- the loading/setup screens say **v1.0.5**;
- Settings → About says **v1.0.5 (js bundle)**;
- a permission inspector now shows the release build requests **none** of the
  five template permissions (only the harmless androidx
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` marker remains — see v1.0.4
  notes).

Rule of thumb for the future: **JS-only change → `gradlew assembleRelease`
is enough; anything touching `app.json` (version, permissions, plugins) or
native config → re-run `clean:native` first.**

#### v1.0.4 — the REAL "stuck on Loading…" fix + no more network permission

*(Rebuild note: the flow below predates the v1.0.5 discovery that the android
folder was stale — use the v1.0.5 flow above, which adds `clean:native`.)*

**The eternal "Loading…" had nothing to do with storage.** Every fix in
v1.0.2/v1.0.3 was correct — and completely invisible to the user, because of
one React contract violation in `mobile/src/storage/store.js`:

> `notify()` mutated the store's state object in place
> (`Object.assign(state, next)`), but React's `useSyncExternalStore` only
> re-renders when `getSnapshot()` returns a **new reference** — its
> `checkIfSnapshotChanged()` compares snapshots with `Object.is` and silently
> drops the notification when the reference is unchanged (verified in the
> React 19.2 renderer bundled with RN 0.87).
>
> Consequence: after the first paint, **no store transition ever reached the
> UI** — not the successful `loading → ready` after a perfect load, not the
> 15 s watchdog recovery, not the SAF timeouts, nothing. The screen froze on
> "Loading…" (the aurora/spinner screen) forever, across app restarts, on
> every build up to and including v1.0.3. The UI only ever repainted when an
> unrelated `useState` (`booted`, `busy`, `tab`) happened to change — which
> is precisely why it looked like a storage/file problem.

`notify()` now publishes a fresh state object on every transition
(`state = { ...state, ...next }`). New regression tests replicate React's
exact visibility rule (`__tests__/store-snapshot.test.js`) and mount the full
`<App>` tree with a restored folder to prove the setup screen **and the
board** are actually reached (`__tests__/app-boot-full.test.js` — the board
branch had never been rendered in tests before). Verified: 5 of the 8 new
tests fail against the old mutation, all pass with the fix.

**Why did the app request INTERNET (and SYSTEM_ALERT_WINDOW, VIBRATE)?**
Pure Expo-bare-template baggage — none of them are used. v1.0.4 ships
`mobile/plugins/with-release-permissions.js`, which writes a **release-only**
manifest overlay (`android/app/src/release/AndroidManifest.xml`) removing all
five template permissions (INTERNET, SYSTEM_ALERT_WINDOW, VIBRATE,
READ/WRITE_EXTERNAL_STORAGE) from the merged **release** manifest:

- the app is fully offline — `habit.json` is synced by *Syncthing*, and the
  app only reads/writes it locally through SAF (which needs no storage
  permissions at all);
- the **debug** variant keeps its permissions (Metro/dev-server tooling —
  dev builds are never shipped);
- the `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` entry you may see in
  permission-inspector apps **stays**: androidx-core injects it at build time
  for safely registering runtime broadcast receivers on Android 13+; it is a
  self-defined signature marker that grants nothing to anyone and cannot be
  opted out of without breaking receiver registration.

**Build identification:** every loading/setup screen now shows its version
("Loading… v1.0.4", "v1.0.4" in the setup footer) — a screenshot of a stuck
app now identifies the exact installed APK. (We lost a whole debugging round
because there was no way to tell which build a "stuck on loading" screenshot
came from.)

**Rebuilding:**

```bash
git pull
npm install                    # postinstall patches (unchanged since v1.0.3, but cheap)
cd mobile/android
.\gradlew assembleRelease      # Windows
```

Install the new APK over the old one (versionCode 5) and open it — if it
still misbehaves, the screen itself now says which version you are running
and the store's watchdog/timeout errors are actually displayed.

#### v1.0.3 — fixing "stuck on Loading…" / "created habit.json but it can't be read"

Three device-only bugs shipped in v1.0.2's storage layer, all found by reading
expo-file-system 57.0.6's actual sources (`src/legacy/FileSystem.ts` +
`FileSystemLegacyModule.kt`):

1. **`createFileAsync` arguments were swapped.** Expo's real signature is
   `createFileAsync(parentUri, fileName, mimeType)` — the adapter passed
   `(dirUri, mime, name)`, so on a real device every created document was
   *named* `application/json` with mime type `habit.json`. "Create default
   habit.json" wrote a file the app could never find again — exactly
   "created it but still cannot read it". (The unit suite missed it because
   the SAF mock had invented the same wrong order the adapter used; the mock
   now mirrors expo's real signature.)
2. **The crash reporter imported the wrong expo entry point.** SDK 57's root
   `expo-file-system` has no `documentDirectory` and its legacy string
   methods are stubs that *throw* — `diagnostics.js` now imports
   `expo-file-system/legacy` like the SAF adapter does.
3. **expo's `getInfoAsync` leaks one file descriptor per call on content
   URIs** (the stream is opened, never closed). The store's 15-second
   change-detection poll leaked ~240 fds/hour until every SAF call started
   failing. `mobile/plugins/patch-expo-fs-leak.js` (npm postinstall + every
   prebuild) patches the Kotlin to close the stream — see the file for the
   exact edit.

The atomic-write tmp document was also renamed `habit.json.tmp` →
`.tracker.tmp.json`: Android's `DocumentsContract` appends the mime extension
to any display name that lacks it (`habit.json.tmp` would be created as
`habit.json.tmp.json`, unfindable for cleanup), and the plain name is the
*desktop* app's own atomicSave temp, which the phone must never delete while
Syncthing is mid-delivery.

**Rebuilding after these fixes** (the fd-leak patch makes `npm install`
mandatory, not just a `git pull`):

```bash
git pull
npm install                    # runs the postinstall patches (incl. patch-expo-fs-leak.js)
cd mobile/android
.\gradlew assembleRelease      # Windows
```

Folders used with the broken v1.0.2 may contain junk documents named
`application.json` / `application (1).json` — those are mis-named
habit.json copies the old build created; they are never read or written by
v1.0.3 and can be deleted manually (the real `habit.json` is untouched).

#### Building the standalone APK (release) — the only APK that works without Metro

```bash
npm run prebuild --workspace @habit-tracker/mobile  # regenerates mobile/android from scratch; pins Gradle via mobile/plugins/
cd mobile/android
.\gradlew assembleRelease                                 # Windows (./gradlew assembleRelease on macOS/Linux)
# APK lands in mobile/android/app/build/outputs/apk/release/app-release.apk
```

If `assembleRelease` dies on
`ninja: error: manifest 'build.ninja' still dirty after 100 tries`
(the `:react-native-reanimated:buildCMakeRelWithDebInfo` task)
**or** on
`ninja: error: mkdir(CMakeFiles/worklets.dir/C_/Users/…/Common)`
(the `:react-native-worklets:buildCMakeRelWithDebInfo` task)
**or** on
`ninja: error: mkdir(safeareacontext_autolinked_build/…/C_/Users/…)`
(the `:app:buildCMakeRelWithDebInfo` task — same Windows `MAX_PATH`
encoding, now in the app's New-Arch codegen cmake), run this once
after `git pull`, then retry the gradle command — do **not** re-run
prebuild:

```bash
npm run clean:native --workspace @habit-tracker/mobile
cd mobile/android
.\gradlew assembleRelease
```

That script patches Reanimated/Worklets/safe-area-context CMake (and the
app cmake) for Windows so object-file paths stay under `MAX_PATH`, and
deletes the stale `.cxx` caches from the failed run (library `.cxx` **and**
`android/app/.cxx`). Details under **Android build troubleshooting** below.

If instead Gradle dies on
`Task ':expo:releaseSourcesJar' uses this output of task ':expo:generatePackagesList'`,
re-apply the Expo Gradle 9 patches (no prebuild, no cache wipe) and retry:

```bash
node mobile/plugins/patch-expo-gradle-kotlin.js
cd mobile/android
.\gradlew assembleRelease
```

A successful release build now ends with this gate (added by
`mobile/plugins/with-standalone-release.js`):

```
[with-standalone-release] STANDALONE APK VERIFIED - assets/index.android.bundle present (2.8 MB)
[with-standalone-release] Install it on the device with:
[with-standalone-release]     adb install -r "...app-release.apk"
```

The same gate runs for `assembleDebug` (`STANDALONE DEBUG APK VERIFIED`). If
an embedded bundle were missing, the BUILD fails with a clear reason — you
never see a red screen on the phone. Release APKs are signed with the debug
keystore by default (fine for personal use and sideloading; generate a real
keystore before any store/public release).

#### Why an APK says "Unable to load script" (debug vs release)

React Native apps ship their JavaScript **inside the APK**
(`assets/index.android.bundle`). Verified against react-native 0.87.1 + expo 57
sources: the app's JS loader (`ExpoReactHostFactory`) **always** reads that
embedded asset on cold start — every build type, no Metro fallback (this app
does not ship expo-dev-launcher). And the RN Gradle plugin used to bundle that
asset into **release only** (`debuggableVariants` defaults to
`["debug", "debugOptimized"]`). A debug APK therefore had no JS at all and
could never start.

**Since v1.0.2 the plugin injects `debuggableVariants = []`** — every variant
embeds the standalone bundle, so *any* APK you install boots on its own:

| Build | JS bundle inside the APK? | Runs without Metro? | Launcher shows | Settings shows | Typical size |
|---|---|---|---|---|---|
| `assembleDebug` (v1.0.2+) | **Yes** | ✅ standalone | Habit Tracker **DEBUG** | `versionName 1.0.2-debug` | **big** (~180 MB — unstripped native code for all CPU architectures; this is normal for debug) |
| `assembleRelease` | **Yes** (~2.8 MB Hermes bytecode) | ✅ standalone | Habit Tracker | `versionName 1.0.2` | a fraction of debug |

> Saw a ~181 MB APK? That was the **debug** variant — its size, not the
> release build's. Debug APKs carry unoptimized native code for all four CPU
> architectures. Prefer `app-release.apk` for daily use.

If you install a debug APK **built before v1.0.2** (or from an old checkout),
it still has no JS and shows the red screen — rebuild after `git pull`.

The debug buildType is also marked with a `versionNameSuffix "-debug"`
(injected by `mobile/plugins/with-standalone-release.js`), so you can always
tell which build is installed: Android → Settings → Apps → Performance
Tracker DEBUG.

- The red screen's mention of "Metro", "localhost:8081" and `adb reverse` is
  boilerplate from React Native's script loader — it is **not** the app trying
  to sync or reach the internet. The app's own code (Syncthing-folder sync)
  never even started, because its JavaScript never loaded.
- Traps that put a **pre-v1.0.2** debug build (the red-screening kind) on your
  phone — after pulling v1.0.2+ these produce working standalone APKs, but
  they stay LARGE and are labeled "DEBUG":
  - `npm run android` / `npx expo run:android` (mobile workspace) — builds and
    installs the **debug** variant
  - Android Studio's green Run button — always installs the **debug** variant
  - installing `app-debug.apk` instead of `app-release.apk`

#### If the app crashes right when you open it

A **release** build has no red error screen — any fatal startup error just
closes the app silently. Three layers of evidence exist, pick whichever is
easiest:

1. **JavaScript crashes — shown on screen (since v1.0.1).** The app records
   its own fatal JS errors (`mobile/src/diagnostics.js`): the **next launch**
   shows a dark screen — *"The app hit an error last time"* — with the error
   name, message and stack. Screenshot that screen and send it; tap
   **Continue to the app** to dismiss and carry on.

2. **Native crashes — written to a file (since v1.0.1).** A native
   UncaughtExceptionHandler (`mobile/plugins/with-crash-log.js`, installed by
   prebuild) writes every process-killing error — including native crashes a
   JS reporter cannot see — to **two files on the phone**, no adb required:
   - `Downloads/habit-tracker-crash-<timestamp>.txt` — open with any Files app
     and share the newest one after reproducing the crash
   - app-private `files/habit-tracker-crash-latest.txt` (backup copy)

3. **System-level log — for already-installed older builds.** Windows:
   double-click [`capture-crash.bat`](capture-crash.bat) at the repo root with
   the phone connected over USB (Developer options → USB debugging). It saves
   the crash buffer, recent log, installed-package info and device info to
   the Desktop. Or paste this into PowerShell:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -b crash -d > "$env:USERPROFILE\Desktop\crash.txt"
```

The bat's `habit-tracker-package.txt` output also shows `versionName` — telling
you whether the installed build is the debug variant (`1.0.2-debug`) or
release (`1.0.2`).

History: the v1.0.0 release APK crashed on launch because `App` called
`useSafeAreaInsets()` with **no `<SafeAreaProvider>` ancestor** — Expo's
`registerRootComponent` registers the root component as-is. The first render
threw, and a release build turns that into an instant crash. `App` now mounts
the provider itself (with `initialWindowMetrics`), and two boot smoke tests
(`mobile/__tests__/app-boot*.test.js`) mount the **full** component tree in
CI so a broken first render can never reach an APK again.

```bash
# Other useful commands:
npm run start --workspace @habit-tracker/mobile   # Expo dev server (fast JS iteration)
npm run test:core:rn                                    # Hermes drift guard
npm run clean:native --workspace @habit-tracker/mobile  # repair Windows C++ build caches
```

#### Android build troubleshooting — ninja C++ failures on Windows

The release build compiles C++ through CMake + ninja for
`react-native-reanimated`, `react-native-worklets`, and (via the app's
New-Arch cmake) codegen of `react-native-safe-area-context`. On Windows
three toolchain failures show up, none of which is a bug in the app's
code:

1. `ninja: error: manifest 'build.ninja' still dirty after 100 tries` —
   those libraries' `file(GLOB_RECURSE … CONFIGURE_DEPENDS)` makes ninja
   regenerate `build.ninja` forever.
2. `ninja: error: mkdir(CMakeFiles/worklets.dir/C_/Users/…/Common)` —
   CMake encoded an absolute `C:\Users\…` source path into the object-file
   directory past Windows `MAX_PATH` (260).
3. `ninja: error: mkdir(safeareacontext_autolinked_build/…/C_/Users/…)` —
   the same encoding, inside `:app:buildCMakeRelWithDebInfo`. Autolinked
   codegen sources sit *outside* the app `CMAKE_SOURCE_DIR`, so CMake will
   not relativize them; even `CMAKE_OBJECT_PATH_MAX=250` cannot save the
   long-named codegen files (e.g. `RNCSafeAreaViewComponentDescriptor.cpp.o`
   — the md5-hash shortening needs `32 + filename ≤ 250 − dir_len`, and the
   `.cxx` object dir is already ~178 chars). The patch compiles short
   `pt_<md5>.cpp` stubs in each target's binary dir that `#include` the
   real file, which caps every object path at ~220 chars.

   **Root cause of earlier failed attempts:** the stub pass was gated on
   `if(NOT WIN32)` — but `WIN32` describes the *target* platform and is
   false for **every** Android build, so the pass never ran (dead code) and
   the mkdir failure kept coming back. The gate is now
   `CMAKE_HOST_WIN32` (the *build host*), with
   `-DPT_WIN_SHORT_OBJECTS_FORCE=ON` as an any-host escape hatch (used to
   verify the pass on Linux/macOS with the same CMake the Android SDK
   ships). The patcher also **upgrades an older block already sitting in
   `node_modules` in place** (strip + re-inject), so `git pull` +
   `clean:native` is enough — no reinstall needed.

The repo now patches those CMakeLists, the RN default app cmake, and
`app/build.gradle` cmake arguments at `npm install`, at prebuild, and as
part of `clean:native`. The patch strips `CONFIGURE_DEPENDS`, sets
`CMAKE_SUPPRESS_REGENERATION`, keeps `CMAKE_OBJECT_PATH_MAX=250` (the
Windows default — 1024 skipped hashing, 128 hashed then fell back because
the hash still did not fit), and **relativizes** globbed C++ sources so
object dirs are `__/common/cpp/...` instead of `C_/Users/...`. After a
`git pull` of this fix you still have to wipe the **already-written**
`.cxx` scratch from the failed run (including `android/app/.cxx`):

```bash
npm run clean:native --workspace @habit-tracker/mobile
cd mobile/android && gradlew assembleRelease
```

`clean:native` (1) re-applies the CMake patch so you do not need to re-run
prebuild, (2) stops the Gradle daemons that hold file locks, (3) deletes the
`.cxx` scratch dirs of the C++ libraries **and** `android/app/.cxx`, plus the
app's build outputs. Sources and downloads stay put.

If the **same** ninja error comes straight back after that patched rebuild,
it is no longer the CMakeLists loop. Remaining environmental causes:

1. **Windows Defender (or another antivirus) re-scanning freshly written
   build files**, changing their timestamps behind ninja's back:
   Windows Security → Virus & threat protection → Manage settings →
   Exclusions → *Add an exclusion* → **Folder** → add the whole repo folder
   (`C:\Users\...\Habit-Tracker`), then clean-rebuild once more.

2. **System clock drift** (ninja compares file timestamps): make sure Windows
   time sync is on (Settings → Time & language). Rare, but documented.

#### The app says "No habit.json in this folder"

That screen is not an error state to panic about — it means exactly what it
says: **the folder you picked on the phone does not contain `habit.json`
(yet)**. The file's journey is:

```
desktop PC:  <SyncThis folder>\habit.json  (created by the desktop app)
                    │  Syncthing syncs the folder to the phone…
                    ▼
phone:       <Syncthing folder>/habit.json  ← pick THIS folder in the app
```

Checklist, in order:

1. On the PC: the desktop app has run at least once and its data file exists
   (default: a `SyncThis` folder next to the desktop app's .exe, or
   `Documents\SyncThis`, or a custom path chosen in the desktop app).
2. Syncthing on the PC shares **that exact folder**; Syncthing on the phone
   has accepted the share and shows the folder as **Up to Date** — open the
   Syncthing app and verify, and confirm `habit.json` is visible in the
   folder with any Android Files app.
3. In Habit Tracker, pick the phone-side Syncthing folder (the one from
   step 2 — not Downloads, not the folder's parent).
4. If Syncthing finishes syncing *after* you picked the folder, the app
   re-checks on its own every ~15 s and opens the board the moment the file
   arrives — or tap **Check again** on the setup screen to force it.

No PC-side data file yet, or you want a fresh start on the phone? Tap
**Create default habit.json** — Syncthing then carries that file back to
the PC, and the desktop app picks it up. (If a habit.json appears while
you sit on that screen, the button writes the defaults *into* the existing
file and keeps a backup of its previous content in the app's private area.)

> **Fixed in this version:** two bugs made the "missing file" screen lie and
> then hang. (1) The app compared file names against Android's internal
> *document ids* (`primary:Folder/habit.json`) instead of display names, so
> a habit.json that WAS in the picked folder could not be found. (2) When
> some devices' storage provider stalls, "Create default habit.json" and
> the folder picker spun forever — every storage operation now carries a
> 20 s timeout that turns a stall into an actionable "pick the folder again"
> message instead of an endless spinner, and a stalled folder read can no
> longer freeze the boot splash.

#### Android SDK prerequisites

`gradlew assembleDebug` needs an Android SDK (the Gradle build auto-installs
missing platform 37 / build-tools 37 / NDK 27.1 as long as one SDK root exists
and its licenses were accepted — Android Studio's first-run wizard does both).

Point the build at your SDK with either:
- **`ANDROID_HOME` environment variable** (recommended — survives prebuilds):
  `setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"` (Windows), or
- **`mobile/android/local.properties`** containing `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`

Because `expo prebuild --clean` deletes the whole `android/` folder,
`npm run prebuild` is wrapped by [`mobile/scripts/expo-prebuild-safe.js`](mobile/scripts/expo-prebuild-safe.js):
it restores an existing `local.properties` after the clean, or auto-writes one
from `ANDROID_HOME` / the default SDK locations, and prints exact fix
instructions when no SDK is found.

> `mobile/android/` is generated output and gitignored — never edit it by hand.
> It is rebuilt by `npm run prebuild` (which passes `--clean`), and build
> customizations like the Gradle version are enforced by the config plugins in
> [`mobile/plugins/`](mobile/plugins).

See [`docs/SYNC-DESIGN.md`](docs/SYNC-DESIGN.md) for how the two apps share one
file safely, and [`mobile/`](mobile) for the app source.

---

## 🛠️ Installation & Development

### Prerequisites
- Node.js 18+
- npm (workspaces power the monorepo)

### Install Dependencies
```bash
npm install          # at the repo root — installs all workspaces
```

### Development Mode (desktop)
Runs the Vite dev server and opens the Electron app:
```bash
npm run dev
```

### Build Windows Executable
Creates a portable `.exe` and NSIS installer in `desktop/release/`:
```bash
npm run dist:win
```

### Tests & checks
```bash
npm test              # core (Vitest/Node) + desktop (RTL) suites
npm run test:core:rn  # the SAME fixture contract under jest-expo/Hermes
npm run lint          # ESLint across the monorepo
npm run check:core-pin  # drift guard: exact core pin in both apps
```

---

## 📁 Project Structure

```
Habit-Tracker/          # npm workspaces monorepo
├── packages/core/             # @habit-tracker/core — the ONE
│   │                          #   implementation of scoring, schema gate,
│   │                          #   healing, dates, ids (pure JS, no platform)
│   ├── fixtures/              # golden fixtures — the drift contract
│   └── SCHEMA.md              # normative habit.json format
├── desktop/                   # Electron app (React + Vite frontend)
│   ├── src/                   # UI components (Board, Reviews, Settings, …)
│   ├── electron/              # main process (file I/O, watcher, backups)
│   └── build/                 # app icons
├── mobile/                    # Expo / React Native Android app
│   ├── src/storage/           # SAF adapter + tracker store (rebase, backups)
│   ├── src/screens/           # Board, Settings, setup & schema screens
│   └── __tests__/             # Node tests + dual-runtime fixture contract
├── docs/                      # SYNC-DESIGN.md, parked CI workflows
└── scripts/                   # drift guard (check-core-pin.cjs)
```

---

## 📖 Usage Guide

### Creating Tasks
1. Click on the empty row at the bottom of the board
2. Type your task text
3. Press Enter to save
4. A new empty row appears automatically

### Organizing with Categories
1. Click "Show Categories" to open the category grabber
2. Create categories with names and colors
3. Drag a category chip onto the board to create a marker
4. Place markers above and below related tasks
5. Tasks between matching markers show a subtle category indicator

### Completing Tasks
1. Hover over a task row
2. Click the green checkmark button
3. Select the difficulty level
4. Adjust the date if needed (defaults to today)
5. Add an optional note
6. Click "Complete"

### Viewing Your Progress
- **Daily**: Select any date to see tasks completed and your score
- **Weekly**: View the current week's totals and chart
- **Heatmap**: Browse yearly activity at a glance, click any day for details

---

## ⚙️ Configuration

### Difficulty Levels
Default difficulties:
- Easy (score: 1)
- Medium (score: 2)
- Hard (score: 3)
- Very Hard (score: 5)

You can customize labels, scores, and colors in Settings > Difficulties.

### Scoring Formula
For each day, tasks are sorted by completion time:
```
Task 1: base_score × 1.0
Task 2: base_score × 1.1
Task 3: base_score × 1.2
...
Task N: base_score × min(1.0 + (N-1)×0.1, 3.0)
```

### Backups
Automatic backups are stored in `.backups/` folder next to your data file:
- Timestamped filenames (e.g., `habit-20250101-143022.json`)
- Keeps last 20 backups
- Created before risky operations

---

## 🎨 Design Principles

1. 🛡️ **Data Safety First**: Atomic writes, backups, conflict detection
2. ✍️ **Notepad Simplicity**: No forms, no mandatory metadata
3. 🎯 **Core Functionality**: Task tracking, completion, reviews
4. ✨ **Visual Polish**: Clean, modern, satisfying UI
5. 🚫 **No Bloat**: No deadlines, priorities, statuses, or kanban columns

---

## ❌ What This App Is NOT

- 📋 A project management tool
- 📝 A traditional to-do list
- ☁️ Cloud-based or requiring internet
- 🗂️ A kanban board with columns
- 📅 A deadline/priority tracker
- 👥 A team collaboration tool

---

## 🚀 Future Considerations

- Android version reading the same JSON format
- Enhanced conflict resolution strategies
- More visualization options
- Export/import functionality

---

## 📄 License

MIT License

## 🌐 Repository

https://github.com/GetYourWish/Habit-Tracker

---

<div align="center">
  <p>Made with ❤️ for productivity enthusiasts</p>
</div>

