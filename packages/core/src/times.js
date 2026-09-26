// times.js — the time-of-day slot model for "N times per day" habits.
//
// A habit due more than once per day ("brush teeth", "take medication") can
// carry one TIME-OF-DAY SLOT PER OCCURRENCE, e.g. brushing twice a day with
// slots ['morning', 'evening']. Slots are plain user data:
//   habit.timesPerDay  overrides the frequency default (1..12)
//   habit.timesOfDay   optional array of slot keys, one per occurrence
// A completion may record which slot it satisfied (completion.slot), so the
// Today page can check off "the morning brush" independently of the evening
// one. All functions are pure; no clock access (slotForHour takes an hour).

const SLOT_KEYS = ['morning', 'afternoon', 'evening', 'night']

const TIME_OF_DAY_SLOTS = [
  { key: 'morning', label: 'Morning', icon: '🌅', color: '#fbbf24', fromH: 5, toH: 12, hint: '5:00 – 12:00' },
  { key: 'afternoon', label: 'Afternoon', icon: '☀️', color: '#38bdf8', fromH: 12, toH: 17, hint: '12:00 – 17:00' },
  { key: 'evening', label: 'Evening', icon: '🌆', color: '#a78bfa', fromH: 17, toH: 22, hint: '17:00 – 22:00' },
  { key: 'night', label: 'Night', icon: '🌙', color: '#818cf8', fromH: 22, toH: 29, hint: '22:00 – 5:00' }
]

const SLOT_BY_KEY = {}
for (const s of TIME_OF_DAY_SLOTS) SLOT_BY_KEY[s.key] = s

function isValidSlotKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SLOT_BY_KEY, key)
}

function slotInfo(key) {
  return isValidSlotKey(key) ? SLOT_BY_KEY[key] : null
}

// Which slot does a wall-clock hour (0-23) belong to? Night wraps midnight:
// 22, 23, 0..4 → night. Hours before the first slot fall back to the first.
function slotForHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24
  for (const s of TIME_OF_DAY_SLOTS) {
    if (s.key === 'night') continue
    if (h >= s.fromH && h < s.toH) return s.key
  }
  return 'night'
}

// Effective times-per-day for a habit: the habit's own override wins over
// the frequency default ("Twice a day" frequency + a 3× override = 3).
function effectiveTimesPerDay(habit, frequency) {
  const own = habit && Number(habit.timesPerDay)
  if (Number.isFinite(own) && own >= 1) return Math.min(12, Math.floor(own))
  const fromFreq = frequency && Number(frequency.timesPerDay)
  if (Number.isFinite(fromFreq) && fromFreq >= 1) return Math.min(12, Math.floor(fromFreq))
  return 1
}

// The habit's slot list, sanitized. Each entry is either a valid slot key
// or null — null means "this occurrence happens anytime". The list is
// capped at the effective per-day count; an all-null list (no preferred
// times at all) collapses to [] so the UI treats the habit as slotless.
function resolveTimesOfDay(habit, frequency) {
  if (!habit || !Array.isArray(habit.timesOfDay) || habit.timesOfDay.length === 0) return []
  const cap = effectiveTimesPerDay(habit, frequency)
  const out = []
  for (const k of habit.timesOfDay) {
    if (out.length >= cap) break
    out.push(isValidSlotKey(k) ? k : null)
  }
  return out.some(k => k) ? out : []
}

// Count completions of one habit on one date that satisfy a given slot.
// Completions without a slot ("anytime") do not satisfy a specific slot —
// but they DO count toward the day total, preserving legacy totals.
function countSlotDoneOnDate(habit, completions, dateStr, slotKey) {
  let n = 0
  for (const c of completions || []) {
    if (!c || c.habitId !== habit.id || c.date !== dateStr) continue
    if (c.slot === slotKey) n++
  }
  return n
}

// Best-guess slot for a completion that lacks one, given the wall-clock hour
// it happened (used when recording check-offs from the Today page).
function slotForNow(hour, fallbackKey) {
  const key = slotForHour(hour)
  if (fallbackKey && isValidSlotKey(fallbackKey)) return fallbackKey
  return key
}

module.exports = {
  SLOT_KEYS,
  TIME_OF_DAY_SLOTS,
  isValidSlotKey,
  slotInfo,
  slotForHour,
  slotForNow,
  effectiveTimesPerDay,
  resolveTimesOfDay,
  countSlotDoneOnDate
}
