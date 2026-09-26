// defaults.js — the canonical default data structure for habit.json.
// Documented in packages/core/SCHEMA.md; every client creates files exactly
// like this one.
//
// A brand-new install gets a PRE-BUILT STARTER BOARD (see presets.js): rows of
// ordinary user data — rename, re-cadence, recolor or delete anything; nothing
// about these habits is special-cased by the app logic.
//
// DETERMINISM CONTRACT: createDefaultData() called twice in the same process
// returns byte-identical JSON (stable ids, no random uuids, no Date.now()).
// Both apps and the fixture generator rely on this.

const { systemFrequencies } = require('./recurrence')
const { STARTER_GROUPS, STARTER_HABITS } = require('./presets')

// Deterministic id: namespaced FNV hash rendered as a uuid-shaped string
// (stable across platforms so desktop and mobile seed the exact same board).
function stableId(namespace) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const s = `habit-stable:${namespace}`
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 + s.charCodeAt(i) * (i + 7)) >>> 0
  }
  const hex = n => n.toString(16).padStart(8, '0')
  return `${hex(h1)}-${hex(h2).slice(0, 4)}-4${hex(h1 >> 4).slice(0, 3)}-8${hex(h2 >> 4).slice(0, 3)}-${hex((h1 ^ h2) >>> 0)}${hex(h1 >> 8).slice(0, 4)}`
}

// Deterministic pseudo-random in [0,1) from a string seed (FNV-1a → xorshift).
function seededRand(seed) {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h ^= h << 13; h >>>= 0
  h ^= h >> 17
  h ^= h << 5; h >>>= 0
  return (h >>> 0) / 0xffffffff
}

const DAY_MS = 86400000
const SEED_DAYS = 21 // how much check-in history the starter board ships with

function pad(n) { return String(n).padStart(2, '0') }
function ymd(dateUtc) {
  return `${dateUtc.getUTCFullYear()}-${pad(dateUtc.getUTCMonth() + 1)}-${pad(dateUtc.getUTCDate())}`
}

// Create default data structure. `today` is an optional 'YYYY-MM-DD' anchor for
// seeding sample history (defaults to the current UTC date); pass an explicit
// value in tests/generators for full determinism.
function createDefaultData(today) {
  let anchor
  if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const [y, m, d] = today.split('-').map(Number)
    anchor = new Date(Date.UTC(y, m - 1, d))
  } else {
    const now = new Date()
    anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  // --- frequencies (plain editable data; `system:true` = restored by healing)
  const frequencies = systemFrequencies().map(f => ({
    ...f,
    id: stableId(`freq:${f.key}`),
    createdAt: '1970-01-01T00:00:00.000Z'
  }))
  const freqByKey = {}
  for (const f of frequencies) freqByKey[f.key] = f

  // --- groups become ordinary categories (user-owned chips)
  const categories = STARTER_GROUPS.map((g, i) => ({
    id: stableId(`cat:${g.name}`),
    name: g.name,
    color: g.color,
    order: i,
    archived: false
  }))
  const catByName = {}
  for (const c of categories) catByName[c.name] = c

  // --- starter habits + soft-seeded check-in history
  const habits = []
  const board = []
  const completions = []
  STARTER_HABITS.forEach((p, idx) => {
    const freq = freqByKey[p.frequencyKey]
    const cat = catByName[p.group]
    const habitId = stableId(`habit:${p.title}`)
    habits.push({
      id: habitId,
      title: p.title,
      icon: p.icon,
      frequencyId: freq.id,
      categoryId: cat ? cat.id : null,
      color: freq.color,
      order: idx,
      archived: false,
      createdAt: '1970-01-01T00:00:00.000Z'
    })
    board.push({ type: 'habit', habitId })

    const goal = Math.max(1, Number(freq.timesPerPeriod) || 1)
    for (let back = 0; back < SEED_DAYS; back++) {
      const dt = new Date(anchor.getTime() - back * DAY_MS)
      const dateStr = ymd(dt)
      if (!isScheduledAt(freq, dt, dateStr)) continue
      // Recent days almost always done, older days fade out — looks alive.
      const skipChance = back === 0 ? 0.35 : 0.12 + back * 0.01
      if (seededRand(`${habitId}|${dateStr}`) < skipChance) continue
      const times = goal > 1 ? (seededRand(`${habitId}|${dateStr}|t`) < 0.6 ? goal : 1) : 1
      for (let t = 0; t < times; t++) {
        completions.push({
          id: stableId(`done:${habitId}:${dateStr}:${t}`),
          habitId,
          date: dateStr,
          note: '',
          createdAt: '1970-01-01T00:00:00.000Z'
        })
      }
    }
  })

  return {
    schemaVersion: 1,
    meta: {
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z'
    },
    settings: {
      theme: 'system',
      weekStartsOn: 1, // Monday
      heatmapMode: 'consistency',
      seededStarterBoard: true
    },
    frequencies,
    categories,
    habits,
    board,
    // Canonical order (ascending date, then id) — matches the healing sort in
    // schema.js so a freshly seeded file heals byte-identically on first load
    // (anti-churn rule: no pointless rewrite right after seeding).
    completions: completions.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    ),
    logs: [],
    // Legacy task-board sections. The desktop UI and schema healing expect
    // these keys to exist; healing adds them if missing, so the seed must
    // include them (in the same trailing order) for byte-identical heals.
    workingOn: [],
    difficulties: [],
    markers: [],
    tasks: []
  }
}

// Local scheduling mirror of recurrence.isScheduledOn working on Date objects.
// Semantics must stay identical to recurrence.js (same weekStartsOn = 1).
function isScheduledAt(freq, dtUtc) {
  switch (freq.kind) {
    case 'daily': return true
    case 'weekdays': {
      const days = Array.isArray(freq.weekdays) && freq.weekdays.length ? freq.weekdays : [1, 2, 3, 4, 5]
      return days.includes(dtUtc.getUTCDay())
    }
    case 'weekly': {
      if (Array.isArray(freq.weekdays) && freq.weekdays.length) return freq.weekdays.includes(dtUtc.getUTCDay())
      return true
    }
    case 'monthly': {
      if (Array.isArray(freq.monthDays) && freq.monthDays.length) return freq.monthDays.includes(dtUtc.getUTCDate())
      return true
    }
    case 'yearly': {
      if (!freq.anchorDate) return true
      const pad = n => String(n).padStart(2, '0')
      const md = `${pad(dtUtc.getUTCMonth() + 1)}-${pad(dtUtc.getUTCDate())}`
      return freq.anchorDate.slice(5) === md
    }
    case 'every-n': {
      const n = Math.max(1, Number(freq.interval) || 1)
      const anchor = freq.anchorDate
      if (!anchor) return true
      const [ay, am, ad] = anchor.split('-').map(Number)
      const diff = Math.round((dtUtc.getTime() - Date.UTC(ay, am - 1, ad)) / DAY_MS)
      return ((diff % n) + n) % n === 0
    }
    case 'every-n-weeks': {
      const n = Math.max(1, Number(freq.interval) || 1)
      const anchor = freq.anchorDate
      if (!anchor) return true
      // Monday-anchored week index, exactly like periodKey('every-n-weeks')
      // in recurrence.js: weeks = floor(diffDays(startOfWeek(date), startOfWeek(anchor)) / 7)
      const dowMonA = (dtUtc.getUTCDay() + 6) % 7
      const aDt = new Date(anchor + 'T00:00:00Z')
      const dowMonB = (aDt.getUTCDay() + 6) % 7
      const wsA = Math.round(dtUtc.getTime() / DAY_MS) - dowMonA
      const wsB = Math.round(aDt.getTime() / DAY_MS) - dowMonB
      const wIdx = Math.floor((wsA - wsB) / 7)
      const phase = ((wIdx % n) + n) % n
      if (phase !== 0) return false
      if (Array.isArray(freq.weekdays) && freq.weekdays.length) return freq.weekdays.includes(dtUtc.getUTCDay())
      return true
    }
    default: return false
  }
}

module.exports = { createDefaultData, stableId, seededRand }
