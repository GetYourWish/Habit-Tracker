import { useMemo, useState } from 'react'
import {
  TIME_OF_DAY_SLOTS,
  systemFrequencies,
  describeFrequency,
  generateId,
  resolveTimesOfDay
} from '@habit-tracker/core'
import { EMOJI_CATEGORIES, ALL_EMOJIS, searchEmojis } from './emojiCatalog'

// HabitEditor — create/edit modal. THE headline feature: a habit due more
// than once a day gets ONE "best time of day" CHOICE PER OCCURRENCE —
// brushing teeth twice a day = pick Morning for the first, Evening for the
// second. Any occurrence can also stay "Anytime".
//
// 2026-09-27 fixes:
//  - FREQUENCY CHIPS: the fallback catalogue (systemFrequencies) carries no
//    ids, so on files without a frequencies array every chip compared
//    undefined === undefined — ALL picked, none changeable. The list now
//    always gets stable ids, and a habit created from a synthesized
//    catalogue also SAVES that catalogue into the file, so the habit's
//    frequencyId resolves on the next load (healing repairs old files).
//  - EMOJI PICKER: 350+ icons in categories with keyword search and a
//    paste-your-own custom slot (user request: "widen the emoji choice").

const COLORS = [
  '#34d399', '#22d3ee', '#38bdf8', '#a78bfa', '#f472b6', '#fb7185',
  '#fbbf24', '#f97316', '#84cc16', '#10b981', '#818cf8', '#f43f5e'
]

// Sensible spread for N occurrences a day (2×: morning + evening).
function suggestSlots(n) {
  const spread = ['morning', 'evening', 'afternoon', 'night']
  const out = []
  if (n === 3) out.push('morning', 'afternoon', 'evening')
  else if (n === 4) out.push('morning', 'afternoon', 'evening', 'night')
  else if (n === 2) out.push('morning', 'evening')
  else if (n === 1) out.push(null)
  while (out.length < n) out.push(spread.find(k => !out.includes(k)) || null)
  return out.slice(0, n)
}

const SLOT_OPTIONS = [
  ...TIME_OF_DAY_SLOTS.map(s => ({ key: s.key, label: s.label, icon: s.icon, color: s.color })),
  { key: null, label: 'Anytime', icon: '⏰', color: '#94a3b8' }
]

// The catalogue the editor works with: the file's own list when it exists,
// otherwise the system set — and ALWAYS id-bearing (stable synthetic ids for
// id-less entries) so exactly one chip can ever be "picked".
function buildFrequencyList(data) {
  const list = Array.isArray(data.frequencies) && data.frequencies.length
    ? data.frequencies
    : systemFrequencies().map(f => ({ ...f, createdAt: '1970-01-01T00:00:00.000Z' }))
  const seen = new Set()
  return list
    .filter(f => f && typeof f === 'object')
    .map((f, i) => {
      if (typeof f.id === 'string' && f.id) {
        if (seen.has(f.id)) return null // duplicate ids would double-pick
        seen.add(f.id)
        return f
      }
      const id = `freq-${f.key || `custom-${i}`}`
      if (seen.has(id)) return null
      seen.add(id)
      return { ...f, id }
    })
    .filter(Boolean)
}

export default function HabitEditor({ data, onSave, onClose, habit = null, onArchive = null, onDelete = null }) {
  const isEdit = Boolean(habit && habit.id)

  const frequencies = useMemo(
    () => buildFrequencyList(data),
    [data]
  )
  // When the file shipped no catalogue, persist the synthesized one with the
  // habit so frequencyId resolves forever after.
  const mustSaveCatalogue = !(Array.isArray(data.frequencies) && data.frequencies.length)

  const freqById = useMemo(() => {
    const map = {}
    for (const f of frequencies) map[f.id] = f
    return map
  }, [frequencies])

  const initial = habit || {}
  // "Twice a day" as a CATALOG cadence is redundant with the stepper
  // (daily + 2×/day), so edit such habits as "Every day" + timesPerDay 2.
  const rawInitialFreq = freqById[initial.frequencyId] || frequencies[0] || null
  const initialFreq = rawInitialFreq && rawInitialFreq.key === 'twice-daily'
    ? (frequencies.find(f => f.key === 'daily') || rawInitialFreq)
    : rawInitialFreq
  const initialPerDay = Math.max(1, Number(initial.timesPerDay)
    || (Array.isArray(initial.timesOfDay) && initial.timesOfDay.length)
    || Number(initialFreq && initialFreq.timesPerDay)
    || 1)
  const initialSlots = resolveTimesOfDay(initial, initialFreq)

  const [title, setTitle] = useState(initial.title || '')
  const [icon, setIcon] = useState(initial.icon || '⭐')
  const [color, setColor] = useState(initial.color || COLORS[Math.floor(Math.random() * COLORS.length)])
  const [categoryId, setCategoryId] = useState(initial.categoryId || '')
  const [frequencyId, setFrequencyId] = useState(initialFreq ? initialFreq.id : '')
  const [perDay, setPerDay] = useState(initialPerDay)
  const [slots, setSlots] = useState(() => {
    if (initialSlots.length) {
      const out = initialSlots.slice(0, initialPerDay)
      while (out.length < initialPerDay) out.push(null)
      return out
    }
    return initialPerDay > 1 ? suggestSlots(initialPerDay) : [null]
  })
  const [emojiOpen, setEmojiOpen] = useState(false)

  const frequency = freqById[frequencyId] || null
  const categories = (data.categories || []).filter(c => !c.archived)

  const changePerDay = (n) => {
    const next = Math.max(1, Math.min(12, n))
    if (next === perDay) return
    setPerDay(next)
    setSlots(prev => {
      if (next <= prev.length) return prev.slice(0, next)
      // Growing an unset list (e.g. the [null] default at 1×): replace it
      // with the suggested spread for the new count.
      if (prev.every(s => !s)) {
        const sug = suggestSlots(next)
        while (sug.length < next) sug.push(null)
        return sug
      }
      // Growing a customized list: keep every pick, fill new positions
      // with unused suggestions (duplicates become the first free slot).
      const out = prev.slice()
      const sug = suggestSlots(next)
      for (let i = out.length; i < next; i++) {
        let pick = sug[i] || null
        if (pick && out.includes(pick)) {
          pick = ['morning', 'afternoon', 'evening', 'night'].find(k => !out.includes(k)) || null
        }
        out.push(pick)
      }
      return out
    })
  }

  const setSlotAt = (i, key) => {
    setSlots(prev => prev.map((s, idx) => (idx === i ? key : s)))
  }

  const canSave = title.trim().length > 0 && Boolean(frequency)

  const handleSave = () => {
    if (!canSave) return
    const nowIso = new Date().toISOString()
    // Slot storage: drop an all-anytime list (a slotless habit).
    let timesOfDay = null
    if (perDay > 1 && slots.some(s => s)) {
      timesOfDay = slots.slice(0, perDay)
    }
    const freqDefaultPerDay = Math.max(1, Number(frequency && frequency.timesPerDay) || 1)
    const needsPerDay = perDay !== freqDefaultPerDay

    const habitFields = {
      title: title.trim(),
      icon,
      color,
      categoryId: categoryId || null,
      frequencyId: frequency.id,
      archived: false
    }
    if (needsPerDay) habitFields.timesPerDay = perDay
    else delete habitFields.timesPerDay
    if (timesOfDay) habitFields.timesOfDay = timesOfDay

    let habits
    let board
    if (isEdit) {
      habits = (data.habits || []).map(h => (h.id === habit.id ? { ...h, ...habitFields } : h))
      board = data.board || []
    } else {
      const newHabit = {
        id: generateId(),
        ...habitFields,
        order: (data.habits || []).length,
        createdAt: nowIso
      }
      habits = [...(data.habits || []), newHabit]
      board = [...(data.board || []), { type: 'habit', habitId: newHabit.id }]
    }
    const payload = {
      ...data,
      habits,
      board,
      meta: { ...(data.meta || {}), updatedAt: nowIso }
    }
    if (mustSaveCatalogue) payload.frequencies = frequencies
    onSave(payload)
    onClose()
  }

  const previewCadence = describeFrequency(
    frequency,
    { timesPerDay: perDay, timesOfDay: slots.some(s => s) ? slots : undefined }
  )
  const previewSlots = slots.some(s => s)
    ? slots.map(s => (s ? TIME_OF_DAY_SLOTS.find(x => x.key === s).icon : '⏰')).join(' ')
    : '⏰ anytime'

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card" role="dialog" aria-label={isEdit ? 'Edit habit' : 'New habit'}>
        <div className="modal-head">
          <button
            type="button"
            className="emoji-button"
            onClick={() => setEmojiOpen(v => !v)}
            title="Pick an icon"
            aria-label="Pick an icon"
            aria-expanded={emojiOpen}
          >{icon}</button>
          <div className="modal-title">{isEdit ? 'Edit habit' : 'New habit'}</div>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>

        {emojiOpen && (
          <EmojiPicker
            value={icon}
            onPick={e => { setIcon(e); setEmojiOpen(false) }}
            onChange={setIcon}
          />
        )}

        <div className="editor-field">
          <label className="editor-label" htmlFor="habit-title">Name</label>
          <input
            id="habit-title"
            className="editor-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Brush teeth"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />
        </div>

        <div className="editor-field">
          <label className="editor-label">Color</label>
          <div className="color-row">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`color-dot ${c === color ? 'picked' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={c === color}
              />
            ))}
          </div>
        </div>

        <div className="editor-field">
          <label className="editor-label" htmlFor="habit-group">Group</label>
          <select
            id="habit-group"
            className="editor-input"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
          >
            <option value="">No group</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="editor-field">
          <label className="editor-label">How often?</label>
          <div className="chip-row" data-testid="frequency-chips">
            {frequencies.filter(f => f.key !== 'twice-daily').map(f => (
              <button
                key={f.id}
                type="button"
                className={`cadence-chip ${f.id === frequencyId ? 'picked' : ''}`}
                onClick={() => {
                  setFrequencyId(f.id)
                  // A cadence with its own per-day count adopts it (only
                  // sensible default); the stepper remains the real control.
                  const fPerDay = Math.max(1, Number(f.timesPerDay) || 1)
                  if (fPerDay > 1) changePerDay(fPerDay)
                }}
                title={describeFrequency(f)}
                aria-pressed={f.id === frequencyId}
              >
                <span>{f.icon}</span> {f.label}
              </button>
            ))}
          </div>
          <p className="editor-hint">
            Times-per-day is set separately below — that way any cadence can be
            once, twice or six times a day.
          </p>
        </div>

        <div className="editor-field">
          <label className="editor-label" id="perday-label">Times per day</label>
          <div className="stepper" role="group" aria-labelledby="perday-label">
            <button type="button" onClick={() => changePerDay(perDay - 1)} disabled={perDay <= 1} aria-label="Fewer times per day">−</button>
            <div className="stepper-value">
              {perDay}×<small>a day</small>
            </div>
            <button type="button" onClick={() => changePerDay(perDay + 1)} disabled={perDay >= 12} aria-label="More times per day">＋</button>
          </div>
        </div>

        {perDay > 1 && (
          <div className="editor-field" data-testid="slot-pickers">
            <label className="editor-label">Best time of day — one choice per time</label>
            <div className="slot-pickers">
              {slots.slice(0, perDay).map((slot, i) => (
                <div className="slot-picker" key={i}>
                  <span className="slot-picker-label">
                    {i + 1}. {slot ? TIME_OF_DAY_SLOTS.find(s => s.key === slot).label : 'Anytime'}
                  </span>
                  <div className="slot-picker-options">
                    {SLOT_OPTIONS.map(opt => (
                      <button
                        key={String(opt.key)}
                        type="button"
                        className={`slot-option ${slot === opt.key ? 'picked' : ''}`}
                        style={{ '--slot-color': opt.color }}
                        onClick={() => setSlotAt(i, opt.key)}
                        aria-pressed={slot === opt.key}
                        aria-label={`Time ${i + 1} of ${perDay}: ${opt.label}`}
                        title={`${opt.label}${opt.key ? ` (${(TIME_OF_DAY_SLOTS.find(s => s.key === opt.key) || {}).hint || ''})` : ' whenever'}`}
                      >
                        <span>{opt.icon}</span> {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="editor-hint">
              Each pick gets its own check-in on the Today page. “Anytime” occurrences
              sit in the Anytime section with a ×{perDay} progress.
            </p>
          </div>
        )}

        <div className="editor-field">
          <div className="editor-preview">
            <span style={{ fontSize: '1.2rem' }}>{icon}</span>
            <span>{title.trim() || 'Your habit'}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span>{previewCadence}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span>{previewSlots}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-happy" onClick={handleSave} disabled={!canSave}>
            {isEdit ? 'Save changes' : 'Create habit'}
          </button>
          {isEdit && onArchive && (
            <button className="btn-soft" onClick={() => { onArchive(habit); onClose() }}>
              {habit.archived ? 'Restore' : 'Archive'}
            </button>
          )}
          <div className="spacer" />
          {isEdit && onDelete && (
            <button className="btn-danger" onClick={() => { onDelete(habit); onClose() }}>
              Delete
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// EmojiPicker — the widened icon chooser (user request). Category tabs,
// keyword search and a paste-your-own custom field; picking closes it.
function EmojiPicker({ value, onPick, onChange }) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')

  const activeCat = EMOJI_CATEGORIES.find(c => c.key === tab) || null
  const results = query.trim()
    ? searchEmojis(query)
    : activeCat ? activeCat.emojis : ALL_EMOJIS

  const shown = results.slice(0, 240) // keep the panel snappy on huge queries

  return (
    <div className="emoji-panel" data-testid="emoji-grid">
      <div className="emoji-panel-tools">
        <input
          className="emoji-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search icons (brush, run, sleep…)"
          aria-label="Search icons"
        />
        <input
          className="emoji-custom"
          type="text"
          value={value}
          onChange={e => {
            // free-form: paste any emoji (or short text) as the icon
            const next = Array.from(e.target.value).slice(0, 3).join('')
            onChange(next)
          }}
          placeholder="Paste any emoji"
          aria-label="Custom icon"
          title="Paste any emoji here to use it"
        />
      </div>
      <div className="emoji-tabs" role="tablist" aria-label="Icon categories">
        <button
          type="button"
          className={`emoji-tab ${!query && tab === 'all' ? 'picked' : ''}`}
          onClick={() => { setTab('all'); setQuery('') }}
          aria-selected={!query && tab === 'all'}
          role="tab"
        >✳️ All</button>
        {EMOJI_CATEGORIES.map(c => (
          <button
            key={c.key}
            type="button"
            className={`emoji-tab ${!query && tab === c.key ? 'picked' : ''}`}
            onClick={() => { setTab(c.key); setQuery('') }}
            aria-selected={!query && tab === c.key}
            role="tab"
            title={c.label}
          >{c.icon}</button>
        ))}
      </div>
      <div className="emoji-grid">
        {shown.map((e, i) => (
          <button
            key={`${e}-${i}`}
            type="button"
            className={`emoji-cell ${e === value ? 'picked' : ''}`}
            onClick={() => onPick(e)}
            aria-label={`Icon ${e}`}
          >{e}</button>
        ))}
        {shown.length === 0 && (
          <div className="emoji-empty">
            No match{query ? ` for “${query}”` : ''} — paste any emoji in the field above.
          </div>
        )}
      </div>
    </div>
  )
}
