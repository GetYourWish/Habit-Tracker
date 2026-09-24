// CategorySheet — Android bottom sheet equivalent of the desktop category
// sidebar: active categories sorted by priorityMultiplier desc then name
// (desktop CategorySidebar sort). Desktop CategoryChip semantics: tapping
// the chip NAVIGATES to its first marker on the board (handleNavigateToCategory
// → scroll + flash); the separate "+" button places a marker on the board
// (desktop handleAddMarker appends to the END of the board). Plus the
// quick-create form (name + color swatches, priorityMultiplier 1).

import React, { useMemo, useState } from 'react'
// NOTE: TextInput is required by the create-category form below — it was
// missing from this import list, so the form rendered <TextInput> as
// `undefined` and crashed with "Element type is invalid" the moment the
// user tapped "New category" (found by the JSX-binding audit).
import { View, Text, Modal, Pressable, ScrollView, TextInput } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TextButton, FilledButton } from './ui.js'
import { inputStyle } from './dialogs.js'
import { SPACING, RADIUS, TYPE } from '../theme.js'

const PRESET_COLORS = ['#60a5fa', '#8b5cf6', '#f472b6', '#f87171', '#fbbf24', '#4ade80', '#34d399', '#94a3b8']

export function CategorySheet({ theme, visible, categories, onAddMarker, onNavigate, onCreateCategory, onClose }) {
  const insets = useSafeAreaInsets()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])

  const sorted = useMemo(() => {
    return [...(categories || [])]
      .filter(c => c.active !== false)
      .sort((a, b) => {
        const pa = a.priorityMultiplier ?? 1
        const pb = b.priorityMultiplier ?? 1
        if (pb !== pa) return pb - pa
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [categories])

  function close() {
    setCreating(false)
    setName('')
    onClose()
  }

  function submitCategory() {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreateCategory({ name: trimmed, color })
    setCreating(false)
    setName('')
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' }} onPress={close}>
        <Pressable
          onPress={e => e.stopPropagation()}
          style={{
            backgroundColor: theme.bgPrimary,
            borderTopLeftRadius: RADIUS.sheet,
            borderTopRightRadius: RADIUS.sheet,
            maxHeight: '82%',
            paddingBottom: insets.bottom + SPACING.md
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: SPACING.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: SPACING.md }}>
            <Text style={{ flex: 1, color: theme.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 0.1 }}>
              Categories
            </Text>
            <TextButton theme={theme} label="Close" onPress={close} />
          </View>
          <Text style={{ color: theme.textMuted, ...TYPE.caption, paddingHorizontal: SPACING.xl, marginBottom: SPACING.sm }}>
            Tap a category to jump to its marker on the board. Tap + to place a new one.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            {!creating ? (
              <View style={{ paddingHorizontal: SPACING.lg, gap: 2 }}>
                {sorted.map(category => (
                  <Pressable
                    key={category.id}
                    android_ripple={{ color: theme.ripple }}
                    onPress={() => {
                      onNavigate(category)
                      close()
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SPACING.md,
                      paddingVertical: SPACING.md,
                      paddingHorizontal: SPACING.sm,
                      borderRadius: RADIUS.md,
                      opacity: pressed ? 0.8 : 1
                    })}
                    accessibilityLabel={`Jump to ${category.name} on the board`}
                    accessibilityRole="button"
                  >
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: category.color }} />
                    <Text style={{ flex: 1, color: theme.textPrimary, ...TYPE.body }}>{category.name}</Text>
                    {typeof category.priorityMultiplier === 'number' && category.priorityMultiplier !== 1 ? (
                      <Text style={{ color: theme.textMuted, ...TYPE.caption }}>×{category.priorityMultiplier}</Text>
                    ) : null}
                    <Pressable
                      android_ripple={{ color: theme.ripple, borderless: true, radius: 22 }}
                      hitSlop={6}
                      onPress={() => {
                        onAddMarker(category.id)
                        close()
                      }}
                      style={({ pressed }) => ({ padding: 7, borderRadius: 20, opacity: pressed ? 0.7 : 1 })}
                      accessibilityLabel={`Add ${category.name} marker to the board`}
                      accessibilityRole="button"
                    >
                      <Icon name="plus-circle-outline" size={22} color={theme.textSecondary} />
                    </Pressable>
                  </Pressable>
                ))}
                {sorted.length === 0 ? (
                  <Text style={{ color: theme.textMuted, ...TYPE.body, padding: SPACING.lg, textAlign: 'center' }}>
                    No categories yet — create the first one below.
                  </Text>
                ) : null}
                <FilledButton
                  theme={theme}
                  label="New category"
                  icon="plus"
                  onPress={() => setCreating(true)}
                  style={{ marginTop: SPACING.md, marginBottom: SPACING.lg }}
                />
              </View>
            ) : (
              <View style={{ paddingHorizontal: SPACING.xl, gap: SPACING.md, paddingBottom: SPACING.lg }}>
                <TextInput
                  style={inputStyle(theme)}
                  value={name}
                  onChangeText={setName}
                  placeholder="Category name"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  maxLength={100}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
                  {PRESET_COLORS.map(c => (
                    <Pressable
                      key={c}
                      onPress={() => setColor(c)}
                      style={({ pressed }) => ({
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: c,
                        opacity: pressed ? 0.8 : 1,
                        borderWidth: color === c ? 3 : 0,
                        borderColor: theme.textPrimary
                      })}
                      accessibilityLabel={`Color ${c}`}
                    />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm }}>
                  <TextButton theme={theme} label="Cancel" onPress={() => setCreating(false)} />
                  <FilledButton theme={theme} label="Add" onPress={submitCategory} disabled={!name.trim()} style={{ minWidth: 90 }} />
                </View>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
