// HabitsScreen — the mobile management page (desktop HabitsView parity):
// every habit grouped by its group chip, reorder, archive/restore, delete,
// plus the group (category) manager. Every write goes through store.mutate.

import React, { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import {
  indexCompletions,
  calculateStreak,
  calculateBestStreak,
  describeFrequency,
  resolveTimesOfDay,
  systemFrequencies,
  TIME_OF_DAY_SLOTS
} from '@habit-tracker/core'
import {
  updateHabit,
  setHabitArchived,
  deleteHabit,
  createCategory,
  renameCategory,
  setCategoryArchived
} from '../actions.js'
import { frequencyFor } from '../actions.js'
import { SPACING, TYPE, HABIT_ACCENTS } from '../theme.js'
import { GlassCard, Fab, TopAppBar, IconBtn, Dialog, TextButton, FilledButton } from './ui.js'

const GROUP_COLORS = ['#34d399', '#60a5fa', '#a78bfa', '#fbbf24', '#f472b6', '#22d3ee', '#fb7185', '#84cc16']
const FALLBACK_FREQUENCY = systemFrequencies().find(f => f.key === 'daily')

function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function slotsSummary(habit, frequency) {
  const slots = resolveTimesOfDay(habit, frequency).filter(k => k)
  if (!slots.length) return null
  return slots.map(k => (TIME_OF_DAY_SLOTS.find(s => s.key === k) || {}).icon).join(' ')
}

export function HabitsScreen({ theme, state, store, onAddHabit, onEditHabit }) {
  const data = state.data
  const [showArchived, setShowArchived] = useState(false)
  const [groupForm, setGroupForm] = useState(null) // {mode:'create'|'rename', id, name, color}

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
    const map = new Map()
    for (const h of active) {
      const key = h.categoryId && groups[h.categoryId] ? h.categoryId : null
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(h)
    }
    return map
  }, [active, groups])

  const moveHabit = (habit, dir) => {
    store.mutate((d, now) => {
      // Rebuild the board ordering with the habit shifted ±1 among the
      // habit rows (desktop moveHabit parity over habit-only boards).
      const board = [...(d.board || [])]
      const habitRows = board.map((item, i) => ({ item, i })).filter(x => x.item && x.item.type === 'habit')
      const at = habitRows.findIndex(x => x.item.habitId === habit.id)
      const swapWith = dir === 'up' ? at - 1 : at + 1
      if (at === -1 || swapWith < 0 || swapWith >= habitRows.length) {
        return { ...d, meta: { ...(d.meta || {}), updatedAt: now } }
      }
      const a = habitRows[at].item
      const b = habitRows[swapWith].item
      board[habitRows[at].i] = b
      board[habitRows[swapWith].i] = a
      return { ...d, board, meta: { ...(d.meta || {}), updatedAt: now } }
    }).catch(() => {})
  }

  const confirmDelete = (habit) => {
    Alert.alert(
      'Delete habit?',
      `"${habit.title}" and its check-in history will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => store.mutate((d, now) => deleteHabit(d, habit.id, now)).catch(() => {})
        }
      ]
    )
  }

  const renderHabitRow = (habit, isArchived) => {
    const frequency = frequencyFor(data, habit) || FALLBACK_FREQUENCY
    const streak = calculateStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
    const best = calculateBestStreak(habit, frequency, completionsByHabit, today, weekStartsOn)
    const color = habit.color || '#34d399'
    const slotStr = slotsSummary(habit, frequency)
    const cadence = describeFrequency(frequency, habit)
    return (
      <GlassCard key={habit.id} theme={theme} style={{ padding: SPACING.md, marginBottom: SPACING.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
          <Pressable onPress={() => onEditHabit(habit)} android_ripple={{ color: theme.ripple, borderless: true, radius: 26 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: withAlpha(color, 0.22)
              }}
            >
              <Text style={{ fontSize: 22 }}>{habit.icon || '⭐'}</Text>
            </View>
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => onEditHabit(habit)} accessibilityLabel={`Edit ${habit.title}`}>
            <Text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: '700' }}>{habit.title}</Text>
            <Text style={{ color: theme.textSecondary, ...TYPE.caption, marginTop: 1 }}>
              {cadence}{slotStr ? ` ${slotStr}` : ''}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 1 }}>
              🔥 {streak} · best {best}
            </Text>
          </Pressable>
          {!isArchived ? (
            <View style={{ flexDirection: 'row' }}>
              <IconBtn
                name="chevron-up"
                color={theme.textSecondary}
                onPress={() => moveHabit(habit, 'up')}
                accessibilityLabel={`Move ${habit.title} up`}
              />
              <IconBtn
                name="chevron-down"
                color={theme.textSecondary}
                onPress={() => moveHabit(habit, 'down')}
                accessibilityLabel={`Move ${habit.title} down`}
              />
            </View>
          ) : null}
          <IconBtn
            name={isArchived ? 'restore' : 'archive-outline'}
            color={theme.textSecondary}
            onPress={() => store.mutate((d, now) => setHabitArchived(d, habit.id, !isArchived, now)).catch(() => {})}
            accessibilityLabel={isArchived ? `Restore ${habit.title}` : `Archive ${habit.title}`}
          />
          <IconBtn
            name="trash-can-outline"
            color={theme.danger}
            onPress={() => confirmDelete(habit)}
            accessibilityLabel={`Delete ${habit.title}`}
          />
        </View>
      </GlassCard>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <TopAppBar
        theme={theme}
        title="Habits"
        subtitle={`${active.length} active${archived.length ? ` · ${archived.length} archived` : ''}`}
        actions={
          archived.length ? (
            <IconBtn
              name={showArchived ? 'eye-off-outline' : 'eye-outline'}
              color={theme.textSecondary}
              onPress={() => setShowArchived(v => !v)}
              accessibilityLabel="Toggle archived habits"
            />
          ) : null
        }
      />
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 110 }}>
        {[...grouped.entries()].map(([categoryId, habits]) => {
          const group = categoryId ? groups[categoryId] : null
          return (
            <View key={String(categoryId)} style={{ marginBottom: SPACING.md }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  alignSelf: 'flex-start',
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 4,
                  marginBottom: SPACING.sm,
                  backgroundColor: group ? withAlpha(group.color || '#34d399', 0.18) : theme.rowFill
                }}
              >
                {group ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: group.color }} /> : null}
                <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: '800' }}>
                  {group ? group.name : 'No group'}
                </Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '700' }}>{habits.length}</Text>
                {group ? (
                  <IconBtn
                    name="pencil-outline"
                    color={theme.textSecondary}
                    size={15}
                    onPress={() => setGroupForm({ mode: 'rename', id: group.id, name: group.name, color: group.color || GROUP_COLORS[0] })}
                    accessibilityLabel={`Rename ${group.name}`}
                  />
                ) : null}
              </View>
              {habits.map(h => renderHabitRow(h, false))}
            </View>
          )
        })}

        {showArchived && archived.length > 0 ? (
          <View style={{ marginTop: SPACING.md, opacity: 0.85 }}>
            <Text style={{ color: theme.textSecondary, ...TYPE.sectionTitle, marginBottom: SPACING.sm }}>
              ARCHIVED
            </Text>
            {archived.map(h => renderHabitRow(h, true))}
          </View>
        ) : null}

        {/* group manager */}
        <GlassCard theme={theme} style={{ padding: SPACING.lg, marginTop: SPACING.md }}>
          <Text style={{ color: theme.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: SPACING.sm }}>
            🏷️ Groups
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {(data.categories || []).map(c => (
              <Pressable
                key={c.id}
                onPress={() => setGroupForm({ mode: 'rename', id: c.id, name: c.name, color: c.color || GROUP_COLORS[0] })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderWidth: 1.5,
                  borderColor: theme.border,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: c.archived ? 0.5 : 1
                }}
                accessibilityLabel={`Group ${c.name}`}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
                <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: '700' }}>{c.name}</Text>
                {c.archived ? <Text style={{ fontSize: 11, color: theme.textMuted }}>archived</Text> : null}
              </Pressable>
            ))}
            <Pressable
              onPress={() => setGroupForm({ mode: 'create', id: null, name: '', color: GROUP_COLORS[0] })}
              style={{
                borderWidth: 1.5,
                borderColor: theme.flowState,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6
              }}
              accessibilityLabel="New group"
              accessibilityRole="button"
            >
              <Text style={{ color: theme.flowState, fontSize: 13, fontWeight: '700' }}>＋ New group</Text>
            </Pressable>
          </View>
        </GlassCard>
      </ScrollView>

      <Fab theme={theme} label="New habit" icon="plus" onPress={onAddHabit} />

      {/* create / rename group dialog */}
      <Dialog
        theme={theme}
        visible={!!groupForm}
        title={groupForm && groupForm.mode === 'rename' ? 'Rename group' : 'New group'}
        onClose={() => setGroupForm(null)}
        actions={
          <>
            {groupForm && groupForm.mode === 'rename' ? (
              <TextButton
                theme={theme}
                label="Archive"
                onPress={() => {
                  store.mutate((d, now) => setCategoryArchived(d, groupForm.id, true, now)).catch(() => {})
                  setGroupForm(null)
                }}
              />
            ) : null}
            <TextButton theme={theme} label="Cancel" onPress={() => setGroupForm(null)} />
            <TextButton
              theme={theme}
              label="Save"
              disabled={!(groupForm && groupForm.name.trim())}
              onPress={() => {
                const { mode, id, name, color } = groupForm
                store.mutate((d, now) =>
                  mode === 'create'
                    ? createCategory(d, { name: name.trim(), color }, now)
                    : renameCategory(d, id, name.trim(), now)
                ).catch(() => {})
                setGroupForm(null)
              }}
            />
          </>
        }
      >
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            paddingHorizontal: SPACING.md,
            paddingVertical: 10,
            color: theme.textPrimary,
            fontSize: 15,
            backgroundColor: theme.bgSecondary
          }}
          value={groupForm ? groupForm.name : ''}
          onChangeText={t => setGroupForm(f => (f ? { ...f, name: t } : f))}
          placeholder="Group name"
          placeholderTextColor={theme.textMuted}
          autoFocus
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md }}>
          {GROUP_COLORS.map(c => (
            <Pressable
              key={c}
              onPress={() => setGroupForm(f => (f ? { ...f, color: c } : f))}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: c,
                borderWidth: 3,
                borderColor: groupForm && groupForm.color === c ? theme.textPrimary : 'transparent'
              }}
              accessibilityLabel={`Color ${c}`}
              accessibilityRole="button"
            />
          ))}
        </View>
      </Dialog>
    </View>
  )
}
