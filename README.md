# 🚀 Habit Tracker

**Build routines that stick.** A personal, local-first habit tracker for
Windows — with an Android companion that syncs through your own folder.

Brushing teeth in the morning and at night. A jog before work. Reading in bed.
Whatever your rhythm is, Habit Tracker lets you define each habit exactly how
you actually live it — how often, how many times a day, and at what time of
day — then shows you, every single day, *what should be done today*.

No accounts. No cloud. No subscriptions. Your data is one plain file that
stays on your devices.

---

## ✨ Why You'll Like It

| | |
|---|---|
| 🌱 **Today-first** | Open the app and see exactly what's due today — grouped by Morning ☀️, Afternoon, Evening 🌆, Night 🌙 and Anytime ⏰ |
| ⏰ **Time of day, per occurrence** | A habit due twice a day can pick a time for *each* occurrence (brushing = Morning + Evening). Every occurrence gets its own check-in |
| 🔥 **Honest streaks** | Streaks and consistency are recalculated from your history — change a habit's cadence anytime and nothing in your past gets rewritten or unfairly broken |
| 🏠 **Local-first** | Everything lives in a single JSON file on your machine. Works fully offline |
| 🔄 **Sync any way you like** | Drop the file in a Syncthing (or Dropbox, or any) folder and both apps stay in sync across devices |
| 📱 **Desktop + Android** | Same features, same file, same rules on both platforms |

---

## 📥 Getting Started

### Windows desktop

1. Head to the [Releases page](https://github.com/GetYourWish/Habit-Tracker/releases) and download the Habit Tracker installer (NSIS) or the portable `.exe` — the portable version needs no installation at all.
2. Run it. On first launch the app creates your data file automatically:
   - Primary location: `SyncThis/habit.json` next to the app
   - Fallback: `Documents/PerformanceTracker/SyncThis/habit.json`
3. That file *is* your whole habit life. Back it up, move it, sync it — it's just a readable JSON document.

### Android companion

1. Install the Habit Tracker APK (from Releases, or build it yourself — see [For Developers](#-for-developers)).
2. On first launch, the app asks you to pick **one folder** — point it at the same folder your desktop syncs (e.g. your Syncthing folder containing `habit.json`). Only that folder is used; the app requests no broad storage permission.
3. If Android ever revokes the permission, re-grant it from the app's setup screen.

### Syncing between devices

You don't configure syncing inside the app — you sync the **folder** the file
lives in, using Syncthing (recommended) or any file-sync tool you already
trust. Both apps notice external changes automatically (within ~15 seconds),
never overwrite blindly, and surface any sync conflicts to you instead of
silently resolving them.

---

## 📖 Using the App

Both apps share the same four areas: **Today**, **Habits**, **Reviews**, and
**Settings**.

### 1. Today — your main page

Everything due right now, in one glance:

- Habits are sorted into **Morning / Afternoon / Evening / Night / Anytime** sections.
- A habit due multiple times a day shows **one row per occurrence**, each with its own check circle. Tap to check it off, tap again to undo.
- Habits without a preferred time sit in **Anytime** with a ×N progress chip — every tap records one check-in.
- Each row shows your current **streak 🔥** and a little dot grid of the last 7 days.
- A **progress ring** at the top tells you how much of today is done.
- Habits that aren't scheduled for today appear under **"Resting today"** — you can still check them early as bonus points if you feel like it.

That's the entire daily loop: open, tap circles, close the app.

### 2. Habits — create and manage

Tap **+** (or the FAB on Android) to open the habit editor:

1. **Name + emoji + color** — pick from a catalogue of 350+ emoji, search it, or paste your own.
2. **Group** — habits live in groups (Body / Mind / Home / Work out of the box — rename them however you like, add or delete your own).
3. **Cadence** — choose with simple chips: *Every day, Weekdays, Weekends, Every other day, Once/Twice/Three times a week, Monthly, Yearly…* You can also invent custom cadences.
4. **Times per day** — a stepper from 1 to 12. When a habit happens more than once a day, you pick a **best time of day for each occurrence** (the app suggests sensible defaults, like Morning + Evening for 2×, but every slot is yours to change).
5. A live preview line shows exactly how the habit will behave before you save.

In the Habits list you can reorder habits, **archive** them (they stop showing
up but keep their full history), or **delete** them (with a confirmation). The
group manager lets you add, rename, recolor, or delete groups. Every row shows
its streak, best streak, and cadence at a glance.

### 3. Reviews — see how it's going

Choose a 30-day or 90-day window and get:

- **Check-ins in range**, **perfect days** (days where everything due got done), **active days**, and your **best live streak**.
- Per-habit **dot grids** — one dot per day, darker means more check-ins.
- Current streak, best streak, total completions, and a **consistency %** for every habit.

On mobile, the Flow tab draws your daily momentum as a smooth area chart —
tap any point on the curve to see that day's score.

### 4. Settings — tune it to your liking

- **Theme**: Light / Dark / System.
- **Week starts on** Monday or Sunday.
- **Data**: see where your file lives, hit **Backup now**, toggle auto-sync watching.
- Sync conflicts (if any) are surfaced here so you always know what happened.

---

## 💾 Your Data, In Plain Sight

All your habits, check-ins, and settings live in a **single human-readable
JSON file** (`habit.json`). You can open it in any text editor, copy it onto a
USB stick, or move it to a new computer — the app finds it and picks up where
you left off.

A few things happening under the hood, in plain terms:

- **Nothing is ever destroyed casually** — the app keeps the last 20 automatic backups alongside your file before any risky operation.
- **Writes are safe by design** — the app writes to a temporary file first and only swaps it in once it's verified complete, so a crash mid-save can't corrupt your history.
- **The file heals itself** — if something odd creeps in (a stray duplicate, an entry pointing at a deleted habit), the app cleans it up on load without touching anything valid.
- The complete field-by-field format is documented in
  [`packages/core/SCHEMA.md`](packages/core/SCHEMA.md) — it's the shared
  contract that keeps the desktop and Android apps byte-for-byte compatible.

---

## 🛠 For Developers

Want to run the app from source or contribute? Here's the quick path.

**Prerequisites:** Node.js 18+ and npm.

```bash
npm install            # at the repo root — installs all workspaces

npm run dev            # desktop: Vite dev server + Electron window
npm run dist:win       # build the Windows portable .exe + NSIS installer (desktop/release/)

npm test               # core + desktop test suites
npm run lint           # ESLint across the monorepo
```

The project is a small monorepo:

```
├── packages/core/   # the shared brain — scoring, schedule rules, data healing (plain JS)
├── desktop/         # the Windows app (Electron + React)
├── mobile/          # the Android app (Expo / React Native)
└── docs/            # sync design notes
```

Both apps are built on the same core logic, so a habit behaves identically on
every platform. Technical stack in brief: **React 19 + Vite + Electron** on
desktop, **Expo / React Native** on Android, `date-fns` for calendar math and
Chokidar for watching your synced file. The Android release APK is built with
Gradle (`cd mobile/android && ./gradlew assembleRelease`); detailed build notes
live in the git history and `docs/`.

---

## ❌ What This App Is NOT

- 📋 A project-management tool or kanban board
- 📝 A traditional to-do list with deadlines and priorities
- ☁️ A cloud service — there is no server, no account, no telemetry
- 👥 A team collaboration app

It's one thing, done thoroughly: **personal recurring habits, honestly
measured, fully yours.**

---

## 📄 License

MIT License — see [LICENSE](LICENSE).

## 🌐 Repository

https://github.com/GetYourWish/Habit-Tracker

<div align="center">
  <p>Made with ❤️ for people building better routines</p>
</div>
