import { useMemo, useState } from 'react'
import {
  indexCompletions,
  calculateStreak,
  calculateBestStreak,
  describeFrequency,
  resolveTimesOfDay,
  generateId,
  TIME_OF_DAY_SLOTS
} from '@habit-tracker/core'

// HabitsView — the management page: every habit grouped by its group chip,
// reorder, archive/restore, delete, plus the group (category) manager.

const GROUP_COLORS = ['#34d399', '#60a5fa', '#a78bfa', '#fbbf24', '#f472b6', '#22d3ee', '#fb7185', '#84cc16']

export default function HabitsView({ data, onSave, onEditHabit, onAddHabit }) {
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [groupForm, setGroupForm] = useState({ open: false, mode: 'create', id: null, name: '', color: GROUP_COLORS[0] })

  const freqById = useMemo(() => {
    const map = {}
    for (const f of data.frequencies || []) map[f.id] = f
    return map
  }, [data.frequencies])

  const completionsByHabit = useMemo(
    () => indexCompletions(data.completions || []),
    [data.completions]
  )

  const today = new Date().toISOString().slice(0, 10)
  const weekStartsOn = (data.settings && data.settings.weekStartsOn) ?? 1

  // Display order follows the board's habit entries (fallback: habits order)
  const orderedHabits = useMemo(() => {
    const habits = data.habits || []
    const byId = {}
    for (const h of habits) byId[h.id] = h
    const seen = new Set()
    const out = []
    for (const item of data.board || []) {
      if (item && item.type === 'habit' && byId[item.habitId] && !seen.has(item.habitId)) {
        seen.add(item.habitId)
        out.push(byId[item.habitId])
      }
    }
    for (const h of habits) {
      if (!seen.has(h.id)) out.push(h)
    }
    return out
  }, [data.habits, data.board])

  const active = orderedHabits.filter(h => !h.archived)
  const archived = orderedHabits.filter(h => h.archived)

  const groups = useMemo(() => {
    const byId = {}
    for (const c of data.categories || []) byId[c.id] = c
    return byId
  }, [data.categories])

  const grouped = useMemo(() => {
    const map = new Map() // categoryId|null → habits[]
    for (const h of active) {
      const key = h.categoryId && groups[h.categoryId] ? h.categoryId : null
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(h)
    }
    return map
  }, [active, groups])

  const mutate = (fn) => {
    const next = fn()
    onSave({ ...next, meta: { ...(next.meta || data.meta || {}), updatedAt: new Date().toISOString() } })
  }

  const moveHabit = (habitId, dir) => {
    mutate(() => {
      const board = [...(data.board || [])]
      // Indices of the habit-type entries (the display order).
      const habitIdxs = []
      board.forEach((item, i) => { if (item && item.type === 'habit') habitIdxs.push(i) })
      const posInList = habitIdxs.findIndex(i => board[i].habitId === habitId)
      const targetPos = dir === 'up' ? posInList - 1 : posInList + 1
      if (posInList < 0 || targetPos < 0 || targetPos >= habitIdxs.length) return { ...data }
      const a = habitIdxs[posInList]
      const b = habitIdxs[targetPos]
      const tmp = board[a]
      board[a] = board[b]
      board[b] = tmp
      return { ...data, board }
    })
  }

  const archiveHabit = (habit) => {
    mutate(() => ({
      ...data,
      habits: (data.habits || []).map(h => (h.id === habit.id ? { ...h, archived: !h.archived } : h))
    }))
  }

  const deleteHabit = (habit) => {
    mutate(() => ({
      ...data,
      habits: (data.habits || []).filter(h => h.id !== habit.id),
      board: (data.board || []).filter(item => !(item && item.type === 'habit' && item.habitId === habit.id)),
      completions: (data.completions || []).filter(c => c.habitId !== habit.id)
    }))
    setConfirmDelete(null)
  }

  const saveGroup = () => {
    const name = groupForm.name.trim()
    if (!name) return
    mutate(() => {
      if (groupForm.mode === 'create') {
        const cat = {
          id: generateId(),
          name,
          color: groupForm.color,
          order: (data.categories || []).length,
          archived: false
        }
        return { ...data, categories: [...(data.categories || []), cat] }
      }
      return {
        ...data,
        categories: (data.categories || []).map(c => (c.id === groupForm.id ? { ...c, name, color: groupForm.color } : c))
      }
    })
    setGroupForm({ open: false, mode: 'create', id: null, name: '', color: GROUP_COLORS[0] })
  }

  const deleteGroup = (cat) => {
    mutate(() => ({
      ...data,
      categories: (data.categories || []).filter(c => c.id !== cat.id),
      habits: (data.habits || []).map(h => (h.categoryId === cat.id ? { ...h, categoryId: null } : h))
    }))
  }

  const renderHabitRow = (habit, isArchived) => {
    const frequency = freqById[habit.frequencyId] || null
    const streak = calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
    const best = calculateBestStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
    const slots = resolveTimesOfDay(habit, frequency)
    const color = habit.color || (frequency && frequency.color) || '#34d399'
    const slotBadges = slots.filter(k => k).map(k => {
      const s = TIME_OF_DAY_SLOTS.find(x => x.key === k)
      return s ? s.icon : ''
    }).join(' ')
    return (
      <div className="manage-row" key={habit.id}>
        <div className="habit-icon" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
          {habit.icon || '⭐'}
        </div>
        <div className="manage-meta">
          <div className="manage-title">{habit.title}</div>
          <div className="manage-sub">
            {describeFrequency(frequency, habit)}
            {slotBadges && <span> · {slotBadges}</span>}
            {streak > 0 && <span> · 🔥 {streak}</span>}
            {best > streak && <span> (best {best})</span>}
          </div>
        </div>
        {!isArchived && (
          <>
            <button className="icon-btn" title="Move up" aria-label={`Move ${habit.title} up`} onClick={() => moveHabit(habit.id, 'up')}>↑</button>
            <button className="icon-btn" title="Move down" aria-label={`Move ${habit.title} down`} onClick={() => moveHabit(habit.id, 'down')}>↓</button>
          </>
        )}
        <button className="icon-btn" title="Edit" aria-label={`Edit ${habit.title}`} onClick={() => onEditHabit(habit)}>✏️</button>
        {isArchived ? (
          <>
            <button className="icon-btn" title="Restore" aria-label={`Restore ${habit.title}`} onClick={() => archiveHabit(habit)}>♻️</button>
            <button className="icon-btn" title="Delete forever" aria-label={`Delete ${habit.title} forever`} onClick={() => setConfirmDelete(habit)}>🗑️</button>
          </>
        ) : (
          <button className="icon-btn" title="Archive" aria-label={`Archive ${habit.title}`} onClick={() => archiveHabit(habit)}>📦</button>
        )}
      </div>
    )
  }

  const groupEntries = [...grouped.entries()]

  return (
    <div className="habits-wrap">
      <div className="page-head">
        <div className="page-title">Habits</div>
        <button className="btn-happy" onClick={onAddHabit}>＋ New habit</button>
      </div>

      {active.length === 0 && (
        <div className="today-empty">
          <span className="today-empty-icon">🌱</span>
          <h3>No habits yet</h3>
          <p>Add your first one — brushing teeth, a jog, reading before bed…</p>
        </div>
      )}

      {groupEntries.map(([key, list]) => {
        const cat = key ? groups[key] : null
        return (
          <div className="group-block" key={key || 'none'}>
            <div className="group-head" style={{ color: cat ? cat.color : 'var(--text-secondary)' }}>
              {cat ? <span className="dot" style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, display: 'inline-block' }} /> : null}
              {cat ? cat.name : 'No group'}
              <span style={{ fontWeight: 600, opacity: 0.7 }}>· {list.length}</span>
            </div>
            {list.map(h => renderHabitRow(h, false))}
          </div>
        )
      })}

      {archived.length > 0 && (
        <div className="archived-block">
          <button className="today-resting-toggle" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? '▾' : '▸'} {archived.length} archived
          </button>
          {showArchived && archived.map(h => renderHabitRow(h, true))}
        </div>
      )}

      <div className="group-manager">
        <h3>🏷️ Groups</h3>
        <div className="chip-row">
          {(data.categories || []).map(c => (
            <span className="group-chip" key={c.id}>
              <span className="dot" style={{ background: c.color }} />
              {c.name}
              <button className="icon-btn" style={{ width: 22, height: 22, fontSize: '0.8rem' }} title="Rename" onClick={() => setGroupForm({ open: true, mode: 'edit', id: c.id, name: c.name, color: c.color })} aria-label={`Rename ${c.name}`}>✏️</button>
              <button className="icon-btn" style={{ width: 22, height: 22, fontSize: '0.8rem' }} title="Delete group" onClick={() => deleteGroup(c)} aria-label={`Delete ${c.name}`}>✕</button>
            </span>
          ))}
          <button className="btn-ghost" onClick={() => setGroupForm({ open: true, mode: 'create', id: null, name: '', color: GROUP_COLORS[0] })}>＋ New group</button>
        </div>
        {groupForm.open && (
          <div className="group-form">
            <input
              className="editor-input"
              placeholder="Group name (e.g. Body, Home)"
              value={groupForm.name}
              onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') saveGroup() }}
              autoFocus
            />
            <div className="color-row">
              {GROUP_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot ${c === groupForm.color ? 'picked' : ''}`}
                  style={{ background: c }}
                  onClick={() => setGroupForm(f => ({ ...f, color: c }))}
                  aria-label={`Group color ${c}`}
                />
              ))}
            </div>
            <button className="btn-happy" onClick={saveGroup}>{groupForm.mode === 'create' ? 'Add' : 'Save'}</button>
            <button className="btn-ghost" onClick={() => setGroupForm({ open: false, mode: 'create', id: null, name: '', color: GROUP_COLORS[0] })}>Cancel</button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDelete(null) }}>
          <div className="modal-card confirm-card">
            <div className="modal-head">
              <div className="modal-title">Delete “{confirmDelete.title}”?</div>
            </div>
            <p>This removes the habit and its whole check-in history. Consider archiving instead — it keeps history but hides the habit from Today.</p>
            <div className="modal-actions">
              <button className="btn-danger" onClick={() => deleteHabit(confirmDelete)}>Delete forever</button>
              <div className="spacer" />
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
