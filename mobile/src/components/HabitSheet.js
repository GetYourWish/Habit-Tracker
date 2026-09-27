// HabitSheet — the mobile habit editor (desktop HabitEditor parity):
// name, icon (the WIDENED emoji catalogue — categories, search, custom
// paste), color, group, frequency chips (single-select!), times-per-day
// stepper and ONE best-time-of-day choice PER occurrence.
//
// 2026-09-27 parity notes:
//  - the frequency list is ALWAYS id-bearing (the desktop bug: fallback
//    catalogue without ids made every chip compare undefined === undefined,
//    all picked, unchangeable — fixed there in core healing, defended here)
//  - a habit created from a synthesized catalogue persists that catalogue
//    into the file, so frequencyId resolves on every later load.

import React, { useMemo, useState } from 'react'
import { View, Text, TextInput, Modal, ScrollView, Pressable } from 'react-native'
import {
  TIME_OF_DAY_SLOTS,
  systemFrequencies,
  describeFrequency,
  resolveTimesOfDay,
  generateId
} from '@habit-tracker/core'
import { createHabit, updateHabit } from '../actions.js'
import { EMOJI_CATEGORIES, ALL_EMOJIS, searchEmojis } from './emojiCatalog.js'
import { RADIUS, SPACING, TYPE } from '../theme.js'
import { TextButton, FilledButton } from './ui.js'

const COLORS = [
  '#34d399', '#22d3ee', '#38bdf8', '#a78bfa', '#f472b6', '#fb7185',
  '#fbbf24', '#f97316', '#84cc16', '#10b981', '#818cf8', '#f43f5e'
]

const SLOT_OPTIONS = [
  ...TIME_OF_DAY_SLOTS.map(s => ({ key: s.key, label: s.label, emoji: s.icon, color: s.color })),
  { key: null, label: 'Anytime', emoji: '⏰', color: '#94a3b8' }
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

// ALWAYS id-bearing catalogue (see file header).
function buildFrequencyList(data) {
  const list = Array.isArray(data.frequencies) && data.frequencies.length
    ? data.frequencies
    : systemFrequencies().map(f => ({ ...f, createdAt: '1970-01-01T00:00:00.000Z' }))
  const seen = new Set()
  return list
    .filter(f => f && typeof f === 'object')
    .map((f, i) => {
      if (typeof f.id === 'string' && f.id) {
        if (seen.has(f.id)) return null
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

function Label({ theme, children }) {
  return (
    <Text style={{
      color: theme.textSecondary,
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: SPACING.lg,
      marginBottom: SPACING.sm
    }}>
      {children}
    </Text>
  )
}

// --- the widened emoji picker (user request) --------------------------------

function EmojiPicker({ theme, value, onPick, onChange }) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')

  const activeCat = EMOJI_CATEGORIES.find(c => c.key === tab) || null
  const results = query.trim()
    ? searchEmojis(query)
    : activeCat ? activeCat.emojis : ALL_EMOJIS
  const shown = results.slice(0, 240)

  return (
    <View
      style={{
        backgroundColor: theme.bgSecondary,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        padding: SPACING.md,
        marginBottom: SPACING.md
      }}
    >
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <TextInput
          style={{
            flex: 2,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            paddingHorizontal: SPACING.md,
            paddingVertical: 7,
            color: theme.textPrimary,
            fontSize: 13.5,
            backgroundColor: theme.bgPrimary
          }}
          value={query}
          onChangeText={setQuery}
          placeholder="Search icons (brush, run, sleep…)"
          placeholderTextColor={theme.textMuted}
        />
        <TextInput
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            paddingHorizontal: SPACING.md,
            paddingVertical: 7,
            color: theme.textPrimary,
            fontSize: 15,
            textAlign: 'center',
            backgroundColor: theme.bgPrimary
          }}
          value={value}
          onChangeText={t => onChange(Array.from(t || '').slice(0, 3).join(''))}
          placeholder="Paste any"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Custom icon"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: SPACING.sm }} contentContainerStyle={{ gap: 4 }}>
        <Pressable
          onPress={() => { setTab('all'); setQuery('') }}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 10,
            borderRadius: 9,
            borderWidth: 1.5,
            borderColor: !query && tab === 'all' ? theme.flowState : 'transparent',
            backgroundColor: !query && tab === 'all' ? theme.rowFillSelected : 'transparent'
          }}
          accessibilityRole="tab"
          accessibilityLabel="All icons"
        >
          <Text style={{ fontSize: 15 }}>✳️</Text>
        </Pressable>
        {EMOJI_CATEGORIES.map(c => (
          <Pressable
            key={c.key}
            onPress={() => { setTab(c.key); setQuery('') }}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 9,
              borderWidth: 1.5,
              borderColor: !query && tab === c.key ? theme.flowState : 'transparent',
              backgroundColor: !query && tab === c.key ? theme.rowFillSelected : 'transparent'
            }}
            accessibilityRole="tab"
            accessibilityLabel={`${c.label} icons`}
          >
            <Text style={{ fontSize: 15 }}>{c.icon}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {shown.map((e, i) => (
          <Pressable
            key={`${e}-${i}`}
            onPress={() => onPick(e)}
            android_ripple={{ color: theme.ripple, borderless: true, radius: 22 }}
            style={{
              width: 42,
              height: 42,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              backgroundColor: e === value ? theme.flowState : 'transparent'
            }}
            accessibilityLabel={`Icon ${e}`}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 21 }}>{e}</Text>
          </Pressable>
        ))}
        {shown.length === 0 ? (
          <Text style={{ color: theme.textSecondary, ...TYPE.caption, padding: SPACING.md, textAlign: 'left' }}>
            No match{query ? ` for "${query}"` : ''} — paste any emoji above.
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// --- the sheet ---------------------------------------------------------------

export function HabitSheet({ theme, visible, data, store, habit, onClose, onArchive, onDelete }) {
  const isEdit = Boolean(habit && habit.id)

  const frequencies = useMemo(() => buildFrequencyList(data), [data])
  const mustSaveCatalogue = !(Array.isArray(data.frequencies) && data.frequencies.length)

  const freqById = useMemo(() => {
    const map = {}
    for (const f of frequencies) map[f.id] = f
    return map
  }, [frequencies])

  const initial = habit || {}
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

  // reset local state whenever a different habit opens
  const [openId, setOpenId] = useState(isEdit ? initial.id : '__new__')
  const currentId = isEdit ? (habit && habit.id) : '__new__'
  if (openId !== currentId) {
    setOpenId(currentId)
    setTitle(initial.title || '')
    setIcon(initial.icon || '⭐')
    setColor(initial.color || '#34d399')
    setCategoryId(initial.categoryId || '')
    setFrequencyId(initialFreq ? initialFreq.id : '')
    setPerDay(initialPerDay)
    setSlots(initialSlots.length
      ? (() => {
          const out = initialSlots.slice(0, initialPerDay)
          while (out.length < initialPerDay) out.push(null)
          return out
        })()
      : (initialPerDay > 1 ? suggestSlots(initialPerDay) : [null]))
    setEmojiOpen(false)
  }

  const frequency = freqById[frequencyId] || null
  const categories = (data.categories || []).filter(c => !c.archived)
  const canSave = title.trim().length > 0 && Boolean(frequency)

  const changePerDay = (n) => {
    const next = Math.max(1, Math.min(12, n))
    if (next === perDay) return
    setPerDay(next)
    setSlots(prev => {
      if (next <= prev.length) return prev.slice(0, next)
      if (prev.every(s => !s)) {
        const sug = suggestSlots(next)
        while (sug.length < next) sug.push(null)
        return sug
      }
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

  const handleSave = () => {
    if (!canSave) return
    let timesOfDay = null
    if (perDay > 1 && slots.some(s => s)) timesOfDay = slots.slice(0, perDay)
    const freqDefaultPerDay = Math.max(1, Number(frequency && frequency.timesPerDay) || 1)
    const fields = {
      title: title.trim(),
      icon,
      color,
      categoryId: categoryId || null,
      frequencyId: frequency.id,
      archived: false
    }
    fields.timesPerDay = perDay !== freqDefaultPerDay ? perDay : null
    fields.timesOfDay = timesOfDay

    store.mutate((d, now) => {
      let next = isEdit
        ? updateHabit(d, habit.id, fields, now)
        : createHabit(d, fields, now)
      if (mustSaveCatalogue && !(Array.isArray(d.frequencies) && d.frequencies.length)) {
        next = { ...next, frequencies: frequencies }
      }
      return next
    }).then(onClose).catch(() => {})
  }

  const previewCadence = describeFrequency(
    frequency,
    { timesPerDay: perDay, timesOfDay: slots.some(s => s) ? slots : undefined }
  )
  const previewSlots = slots.some(s => s)
    ? slots.map(s => (s ? TIME_OF_DAY_SLOTS.find(x => x.key === s).icon : '⏰')).join(' ')
    : '⏰ anytime'

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close editor" />
        <View
          style={{
            maxHeight: '88%',
            backgroundColor: theme.bgPrimary,
            borderTopLeftRadius: RADIUS.sheet,
            borderTopRightRadius: RADIUS.sheet,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md
          }}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xl }} keyboardShouldPersistTaps="handled">
            {/* head */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.sm }}>
              <Pressable
                onPress={() => setEmojiOpen(v => !v)}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: theme.border,
                  backgroundColor: theme.bgSecondary,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                accessibilityLabel="Pick an icon"
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 27 }}>{icon}</Text>
              </Pressable>
              <Text style={{ color: theme.textPrimary, fontSize: 19, fontWeight: '800', flex: 1 }}>
                {isEdit ? 'Edit habit' : 'New habit'}
              </Text>
              <TextButton theme={theme} label="✕" onPress={onClose} />
            </View>

            {emojiOpen ? (
              <EmojiPicker
                theme={theme}
                value={icon}
                onPick={e => { setIcon(e); setEmojiOpen(false) }}
                onChange={setIcon}
              />
            ) : null}

            <Label theme={theme}>Name</Label>
            <TextInput
              style={{
                borderWidth: 1.5,
                borderColor: theme.border,
                borderRadius: 12,
                backgroundColor: theme.bgSecondary,
                color: theme.textPrimary,
                paddingHorizontal: SPACING.md,
                paddingVertical: 11,
                fontSize: 15.5,
                fontWeight: '600'
              }}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Brush teeth"
              placeholderTextColor={theme.textMuted}
              autoFocus={!isEdit}
            />

            <Label theme={theme}>Color</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
              {COLORS.map(c => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: c,
                    borderWidth: 3,
                    borderColor: c === color ? theme.textPrimary : 'transparent'
                  }}
                  accessibilityLabel={`Color ${c}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: c === color }}
                />
              ))}
            </View>

            <Label theme={theme}>Group</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
              <Pressable
                onPress={() => setCategoryId('')}
                style={chipStyle(theme, !categoryId)}
                accessibilityRole="radio"
                accessibilityState={{ selected: !categoryId }}
              >
                <Text style={{ color: !categoryId ? '#ffffff' : theme.textPrimary, fontWeight: '700', fontSize: 13 }}>
                  No group
                </Text>
              </Pressable>
              {categories.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={chipStyle(theme, c.id === categoryId)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: c.id === categoryId }}
                >
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.color }} />
                  <Text style={{ color: c.id === categoryId ? '#ffffff' : theme.textPrimary, fontWeight: '700', fontSize: 13 }}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Label theme={theme}>How often?</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
              {frequencies.filter(f => f.key !== 'twice-daily').map(f => {
                const selected = f.id === frequencyId
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => {
                      setFrequencyId(f.id)
                      const fPerDay = Math.max(1, Number(f.timesPerDay) || 1)
                      if (fPerDay > 1) changePerDay(fPerDay)
                    }}
                    style={chipStyle(theme, selected)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={f.label}
                  >
                    <Text style={{ fontSize: 13 }}>{f.icon}</Text>
                    <Text style={{ color: selected ? '#ffffff' : theme.textPrimary, fontWeight: '700', fontSize: 13 }}>
                      {f.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={{ color: theme.textMuted, ...TYPE.caption, marginTop: 6 }}>
              Times-per-day is set below — any cadence can be once, twice or six times a day.
            </Text>

            <Label theme={theme}>Times per day</Label>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.md,
                alignSelf: 'flex-start',
                borderWidth: 1.5,
                borderColor: theme.border,
                borderRadius: 14,
                padding: 4,
                backgroundColor: theme.bgSecondary
              }}
            >
              <Pressable
                onPress={() => changePerDay(perDay - 1)}
                disabled={perDay <= 1}
                style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.bgTertiary, alignItems: 'center', justifyContent: 'center', opacity: perDay <= 1 ? 0.35 : 1 }}
                accessibilityLabel="Fewer times per day"
                accessibilityRole="button"
              >
                <Text style={{ color: theme.textPrimary, fontSize: 20, fontWeight: '800' }}>−</Text>
              </Pressable>
              <View style={{ minWidth: 78, alignItems: 'center' }}>
                <Text style={{ color: theme.textPrimary, fontSize: 16, fontWeight: '800' }}>{perDay}× a day</Text>
              </View>
              <Pressable
                onPress={() => changePerDay(perDay + 1)}
                disabled={perDay >= 12}
                style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.bgTertiary, alignItems: 'center', justifyContent: 'center', opacity: perDay >= 12 ? 0.35 : 1 }}
                accessibilityLabel="More times per day"
                accessibilityRole="button"
              >
                <Text style={{ color: theme.textPrimary, fontSize: 20, fontWeight: '800' }}>＋</Text>
              </Pressable>
            </View>

            {perDay > 1 ? (
              <View>
                <Label theme={theme}>Best time of day — one choice per time</Label>
                {slots.slice(0, perDay).map((slot, i) => (
                  <View key={i} style={{ marginBottom: SPACING.md }}>
                    <Text style={{ color: theme.textSecondary, fontSize: 12.5, fontWeight: '800', marginBottom: 5 }}>
                      {i + 1}. {slot ? TIME_OF_DAY_SLOTS.find(s => s.key === slot).label : 'Anytime'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                      {SLOT_OPTIONS.map(opt => {
                        const selected = slot === opt.key
                        return (
                          <Pressable
                            key={String(opt.key)}
                            onPress={() => setSlotAt(i, opt.key)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 5,
                              borderWidth: 1.5,
                              borderColor: selected ? opt.color : theme.border,
                              backgroundColor: selected ? opt.color + '38' : theme.bgSecondary,
                              borderRadius: 11,
                              paddingHorizontal: 11,
                              paddingVertical: 7
                            }}
                            accessibilityLabel={`Time ${i + 1} of ${perDay}: ${opt.label}`}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                          >
                            <Text style={{ fontSize: 13 }}>{opt.emoji}</Text>
                            <Text style={{ color: theme.textPrimary, fontWeight: '700', fontSize: 13 }}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                ))}
                <Text style={{ color: theme.textMuted, ...TYPE.caption }}>
                  Each pick gets its own check-in on the Today screen. Anytime occurrences sit in the Anytime section with a ×{perDay} progress.
                </Text>
              </View>
            ) : null}

            {/* preview */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.sm,
                flexWrap: 'wrap',
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.border,
                borderRadius: 12,
                padding: SPACING.md,
                marginTop: SPACING.lg
              }}
            >
              <Text style={{ fontSize: 18 }}>{icon}</Text>
              <Text style={{ color: theme.textPrimary, fontWeight: '700', fontSize: 14 }}>
                {title.trim() || 'Your habit'}
              </Text>
              <Text style={{ color: theme.textMuted }}>·</Text>
              <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{previewCadence}</Text>
              <Text style={{ color: theme.textMuted }}>·</Text>
              <Text style={{ fontSize: 14 }}>{previewSlots}</Text>
            </View>

            {/* actions */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.lg }}>
              <FilledButton theme={theme} label={isEdit ? 'Save changes' : 'Create habit'} onPress={handleSave} disabled={!canSave} />
              {isEdit && onArchive ? (
                <TextButton theme={theme} label={habit.archived ? 'Restore' : 'Archive'} onPress={() => { onArchive(habit); onClose() }} />
              ) : null}
              {isEdit && onDelete ? (
                <TextButton theme={theme} label="Delete" destructive onPress={() => { onDelete(habit); onClose() }} />
              ) : null}
              <TextButton theme={theme} label="Cancel" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function chipStyle(theme, selected) {
  return {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: selected ? theme.flowState : theme.border,
    backgroundColor: selected ? theme.flowState : theme.bgSecondary,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7
  }
}
