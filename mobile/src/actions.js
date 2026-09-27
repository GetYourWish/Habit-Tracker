// actions.js — the pure mutation transforms the Android app applies to
// habit.json data. Every function mirrors the EXACT desktop behavior
// (desktop/src/components/HabitEditor.jsx / TodayView.jsx / HabitsView.jsx)
// and goes through @habit-tracker/core, so both apps write byte-identical
// structures from the same base. Inputs are never mutated.
//
// Every function takes an explicit `now` ISO timestamp (the mutation's
// wall-clock moment) — no hidden Date.now(), fully testable.
//
// v1.1.0: the task-era mutations are gone with the task-era UI. These are
// the habit-model transforms only (updateSettings survives — theme and
// weekStartsOn live in data.settings).

import { generateId, effectiveTimesPerDay, resolveTimesOfDay } from '@habit-tracker/core'

function withMeta(data, now) {
  return { ...data, meta: { ...(data.meta || {}), updatedAt: now } }
}

// --- Habits ---------------------------------------------------------------

// desktop HabitEditor.handleSave (create path): new habit + board APPEND.
// `fields` is the editor's payload — title, icon, color, categoryId,
// frequencyId, and optionally timesPerDay / timesOfDay (per-occurrence
// best-time-of-day picks).
export function createHabit(data, fields, now) {
  const newHabit = {
    id: generateId(),
    title: fields.title,
    icon: fields.icon || '⭐',
    color: fields.color || '#34d399',
    categoryId: fields.categoryId || null,
    frequencyId: fields.frequencyId,
    archived: false,
    order: (data.habits || []).length,
    createdAt: now
  }
  if (Number.isFinite(Number(fields.timesPerDay)) && Number(fields.timesPerDay) >= 1) {
    newHabit.timesPerDay = Math.min(12, Math.floor(Number(fields.timesPerDay)))
  }
  if (Array.isArray(fields.timesOfDay) && fields.timesOfDay.length) {
    newHabit.timesOfDay = fields.timesOfDay.slice()
  }
  return withMeta(
    {
      ...data,
      habits: [...(data.habits || []), newHabit],
      board: [...(data.board || []), { type: 'habit', habitId: newHabit.id }]
    },
    now
  )
}

// desktop HabitEditor.handleSave (edit path): the editor's fields merged
// over the existing habit. timesPerDay/timesOfDay are REPLACED when present
// in the patch, dropped when null (back to the frequency default).
export function updateHabit(data, habitId, fields, now) {
  return withMeta(
    {
      ...data,
      habits: (data.habits || []).map(h => {
        if (h.id !== habitId) return h
        const next = { ...h, ...fields }
        if ('timesPerDay' in fields) {
          if (fields.timesPerDay == null) delete next.timesPerDay
          else next.timesPerDay = Math.min(12, Math.max(1, Math.floor(Number(fields.timesPerDay) || 1)))
        }
        if ('timesOfDay' in fields) {
          if (fields.timesOfDay == null) delete next.timesOfDay
          else next.timesOfDay = fields.timesOfDay.slice()
        }
        return next
      })
    },
    now
  )
}

// desktop HabitsView archive toggle
export function setHabitArchived(data, habitId, archived, now) {
  return withMeta(
    {
      ...data,
      habits: (data.habits || []).map(h => (h.id === habitId ? { ...h, archived } : h))
    },
    now
  )
}

// desktop App.jsx onDelete: drop the habit + its board rows + its history
export function deleteHabit(data, habitId, now) {
  return withMeta(
    {
      ...data,
      habits: (data.habits || []).filter(h => h.id !== habitId),
      board: (data.board || []).filter(
        item => !(item && item.type === 'habit' && item.habitId === habitId)
      ),
      completions: (data.completions || []).filter(c => c.habitId !== habitId)
    },
    now
  )
}

// --- Check-ins (desktop TodayView.toggleOccurrence, exact parity) ----------

// One tap on an occurrence row:
//  - `slot` set (a time-of-day occurrence): a matching completion toggles
//    (undo removes the latest; done adds one with that slot)
//  - `slot` null (an Anytime occurrence): taps fill one slotless completion
//    at a time up to `count`, then start removing the latest again
//  - a huge `count` (bonus check-in for a not-scheduled habit) always ADDS
export function toggleHabitCompletion(data, { habitId, date, slot, count = 1 }, now) {
  const existing = (data.completions || []).filter(c => c.habitId === habitId && c.date === date)
  const completions = [...(data.completions || [])]

  if (slot) {
    const matching = existing.filter(c => c.slot === slot)
    if (matching.length) {
      const target = matching[matching.length - 1]
      const idx = completions.findIndex(c => c.id === target.id)
      if (idx >= 0) completions.splice(idx, 1)
    } else {
      completions.push({
        id: generateId(),
        habitId,
        date,
        slot,
        note: '',
        createdAt: now
      })
    }
  } else {
    const slotless = existing.filter(c => !c.slot)
    if (slotless.length < (count || 1)) {
      completions.push({
        id: generateId(),
        habitId,
        date,
        note: '',
        createdAt: now
      })
    } else if (slotless.length) {
      const target = slotless[slotless.length - 1]
      const idx = completions.findIndex(c => c.id === target.id)
      if (idx >= 0) completions.splice(idx, 1)
    }
  }
  return withMeta({ ...data, completions }, now)
}

// --- Groups (categories) ----------------------------------------------------

// desktop HabitsView group manager create
export function createCategory(data, { name, color }, now) {
  const newCategory = {
    id: generateId(),
    name,
    color: color || '#34d399',
    order: (data.categories || []).length,
    archived: false
  }
  return withMeta({ ...data, categories: [...(data.categories || []), newCategory] }, now)
}

export function renameCategory(data, categoryId, name, now) {
  return withMeta(
    {
      ...data,
      categories: (data.categories || []).map(c =>
        c.id === categoryId ? { ...c, name } : c
      )
    },
    now
  )
}

export function setCategoryArchived(data, categoryId, archived, now) {
  return withMeta(
    {
      ...data,
      categories: (data.categories || []).map(c =>
        c.id === categoryId ? { ...c, archived } : c
      )
    },
    now
  )
}

// --- Settings ---------------------------------------------------------------

// desktop Settings.handleSettingChange — merge one key into data.settings
export function updateSettings(data, patch, now) {
  return withMeta(
    { ...data, settings: { ...(data.settings || {}), ...patch } },
    now
  )
}

// --- helpers shared by the screens (kept pure & testable) -------------------

// The frequency a habit effectively runs on: the file's entry, or the daily
// fallback for broken/legacy references (desktop TodayView parity).
export function frequencyFor(data, habit) {
  const list = Array.isArray(data && data.frequencies) ? data.frequencies : []
  const direct = list.find(f => f && f.id === habit.frequencyId)
  if (direct) return direct
  const daily = list.find(f => f && f.key === 'daily')
  if (daily) return daily
  return null
}

export { effectiveTimesPerDay, resolveTimesOfDay }
