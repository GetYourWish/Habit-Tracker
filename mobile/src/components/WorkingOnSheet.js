// WorkingOnSheet — Android port of the desktop "Working On" popup
// (desktop WorkingOnMarker.jsx: the nav marker button opens WorkingOnPopup
// listing every task currently being worked on, with its category color
// dot + tinted row background, and completing straight from the list).
//
// Mobile mapping:
//  - the desktop nav marker button becomes the "Working On (N)" pill on
//    the Board today-card (BoardScreen) — it opens this bottom sheet.
//  - the desktop in-popup completion section becomes the standard
//    CompleteDialog (dialogs.js) opened ON TOP of this sheet when a task
//    is tapped — same dialog, same completeTask action, same verified
//    write cycle as completing from a board row. Completing closes BOTH
//    (desktop closes the whole popup too); cancel returns to the list.
//  - the desktop "Export Image" button is Electron-only (html-to-image +
//    native save dialog) and has no mobile equivalent — intentionally
//    not ported.
//
// The desktop popup derives each task's category from the board markers
// (strict above/below same-category rule); BoardScreen already computes
// that exact lookup (categoryLookup, core getTaskCategory parity) and
// hands it in as getCategoryFor.

import React from 'react'
import { View, Text, Modal, Pressable, ScrollView } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { withAlpha } from './rows.js'
import { TextButton } from './ui.js'
import { SPACING, RADIUS, TYPE } from '../theme.js'

export function WorkingOnSheet({ theme, visible, tasks, getCategoryFor, onSelectTask, onClose }) {
  const insets = useSafeAreaInsets()
  const count = (tasks || []).length

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' }}
        onPress={onClose}
      >
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: SPACING.xl,
              paddingTop: SPACING.md
            }}
          >
            <Text style={{ flex: 1, color: theme.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 0.1 }}>
              Working On ({count})
            </Text>
            <TextButton theme={theme} label="Close" onPress={onClose} />
          </View>
          <Text
            style={{
              color: theme.textMuted,
              ...TYPE.caption,
              paddingHorizontal: SPACING.xl,
              marginBottom: SPACING.sm
            }}
          >
            Tap a task to complete it.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md }}>
              {count === 0 ? (
                <Text
                  style={{
                    color: theme.textMuted,
                    ...TYPE.body,
                    padding: SPACING.lg,
                    textAlign: 'center'
                  }}
                >
                  No tasks currently being worked on.
                </Text>
              ) : (
                tasks.map(task => {
                  const category = getCategoryFor ? getCategoryFor(task.id) : null
                  return (
                    <Pressable
                      key={task.id}
                      android_ripple={{ color: theme.ripple }}
                      onPress={() => onSelectTask(task)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: SPACING.md,
                        paddingVertical: SPACING.md,
                        paddingHorizontal: SPACING.md,
                        borderRadius: RADIUS.md,
                        marginBottom: SPACING.xs,
                        // desktop popup: background `${category.color}22`
                        backgroundColor: category ? withAlpha(category.color, '22') : theme.rowFill,
                        opacity: pressed ? 0.8 : 1
                      })}
                      accessibilityLabel={`Complete task: ${String(task?.text ?? '')}`}
                      accessibilityRole="button"
                    >
                      {category ? (
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: category.color
                          }}
                        />
                      ) : null}
                      <Text numberOfLines={3} style={{ flex: 1, color: theme.textPrimary, ...TYPE.body }}>
                        {String(task?.text ?? '')}
                      </Text>
                      <Icon name="check-circle-outline" size={22} color={theme.textSecondary} />
                    </Pressable>
                  )
                })
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
