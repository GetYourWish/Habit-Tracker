// rows.js — interactive board row renderers, mirroring desktop BoardRow.jsx
// visuals and behavior:
//  - task rows: row-fill card, category color bar, tap-to-edit text,
//    working-on star (flowState highlight), complete ✓, delete 🗑
//  - marker rows: centered pill with category.color+'4D' background,
//    "/Name" label, note indicator (i), add-task-below (+), delete ✕
//    - consecutive markers (previous visible board item is ALSO a marker)
//      get the settings-driven extra gap above them (desktop
//      .marker-row.consecutive-marker: margin-top var(--consecutive-marker-margin,
//      150px)) — the v1.0.11 "consecutive marker spacing aint working" fix:
//      the setting existed in mobile Settings but the board never applied it
//    - consecutive markers (previous visible board item is ALSO a marker)
//      get the settings-driven extra gap above them (desktop
//      .marker-row.consecutive-marker: margin-top var(--consecutive-marker-margin,
//      150px) — the v1.0.11 "consecutive marker spacing aint working" fix:
//      the setting existed in mobile Settings but the board never applied it)
//  - REARRANGE MODE (v1.0.7): react-native-draggable-flatlist was REMOVED —
//    it is unmaintained for React 19 / reanimated 4 (open crash issues
//    #496/#524/#558, last release 4.0.3 in 2023-era reanimated 2/3 land) and
//    it was the prime suspect for the remote-reported "create a task →
//    crash". Reordering now works exactly like the desktop board: tap the
//    ⋮⋮ handle on any row to enter move mode, then move items with ↑/↓ and
//    tap ✓ on any row when done. Zero gesture/gesture-handler/reanimated
//    dependencies, nothing that can crash mid-write.
//
// '#RRGGBB' + '4D' desktop alpha suffix → rgba() RN color.

import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { RADIUS, SPACING, TYPE } from '../theme.js'

// The teleport/randomizer flash color — desktop components.css hardcodes
// the same amber (`.random-flash` keyframe: rgba(251,191,36,0.5) bg + glow),
// so the mobile highlight is the identical value instead of a theme token.
const FLASH_COLOR = '#fbbf24'

export function withAlpha(hex, alphaHex = '4D') {
  if (typeof hex !== 'string' || hex[0] !== '#' || (hex.length !== 7 && hex.length !== 4)) {
    return hex
  }
  const r = hex.slice(1, 3)
  const g = hex.slice(3, 5)
  const b = hex.slice(5, 7)
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${parseInt(alphaHex, 16) / 255})`
}

// The ⋮⋮ affordance on every row. Tapping it toggles rearrange mode; while
// rearranging every row's handle becomes the ✓ that exits the mode.
function RearrangeHandle({ theme, rearranging, onToggleRearrange }) {
  return (
    <Pressable
      onPress={onToggleRearrange}
      android_ripple={{ color: theme.ripple, borderless: true, radius: 20 }}
      hitSlop={4}
      style={({ pressed }) => ({
        padding: 8,
        borderRadius: 20,
        opacity: pressed ? 0.7 : 1,
        backgroundColor: rearranging ? theme.rowFillSelected : 'transparent'
      })}
      accessibilityLabel={rearranging ? 'Finish rearranging' : 'Rearrange items'}
      accessibilityRole="button"
    >
      <Icon
        name={rearranging ? 'check' : 'drag-vertical'}
        size={20}
        color={rearranging ? theme.flowState : theme.textMuted}
      />
    </Pressable>
  )
}

// ↑/↓ move buttons shown in rearrange mode (desktop move-button parity).
function MoveButtons({ theme, onUp, onDown, upDisabled, downDisabled }) {
  const btn = (name, onPress, disabled, label) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.ripple, borderless: true, radius: 20 }}
      hitSlop={2}
      style={({ pressed }) => ({
        padding: 7,
        borderRadius: 20,
        opacity: disabled ? 0.3 : pressed ? 0.7 : 1
      })}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Icon name={name} size={21} color={theme.textSecondary} />
    </Pressable>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {btn('chevron-up', onUp, upDisabled, 'Move item up')}
      {btn('chevron-down', onDown, downDisabled, 'Move item down')}
    </View>
  )
}

export function TaskRow({
  theme,
  task,
  category,
  isWorkingOn,
  flowStateColor,
  flash,
  onOpen,
  onComplete,
  onDelete,
  onToggleWorkingOn,
  rearranging,
  onToggleRearrange,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}) {
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.rowFill, borderRadius: RADIUS.md, marginBottom: SPACING.xs },
        isWorkingOn && {
          borderWidth: 1.5,
          borderColor: flowStateColor,
          backgroundColor: withAlpha(flowStateColor, '1A')
        },
        // desktop `.board-row.random-flash` — amber highlight while the
        // dice-picked / teleported-to row is being pointed at
        flash && {
          borderWidth: 2,
          borderColor: FLASH_COLOR,
          backgroundColor: withAlpha(FLASH_COLOR, '4D')
        }
      ]}
    >
      {rearranging ? (
        <MoveButtons
          theme={theme}
          onUp={onMoveUp}
          onDown={onMoveDown}
          upDisabled={!canMoveUp}
          downDisabled={!canMoveDown}
        />
      ) : null}
      <RearrangeHandle theme={theme} rearranging={rearranging} onToggleRearrange={onToggleRearrange} />
      {category ? (
        <View
          style={{
            width: 4,
            alignSelf: 'stretch',
            borderRadius: 2,
            backgroundColor: category.color,
            marginRight: SPACING.xs
          }}
        />
      ) : null}
      <Pressable
        onPress={onOpen}
        android_ripple={{ color: theme.ripple }}
        style={{ flex: 1, paddingVertical: 4 }}
        accessibilityLabel={`Task: ${String(task?.text ?? '')}`}
      >
        <Text numberOfLines={4} style={{ color: theme.textPrimary, ...TYPE.body }}>
          {String(task?.text ?? '')}
        </Text>
        {category ? (
          <Text numberOfLines={1} style={{ color: theme.textMuted, marginTop: 1, ...TYPE.caption }}>
            {category.name}
          </Text>
        ) : null}
      </Pressable>
      {rearranging ? (
        <View style={{ width: 44 }} />
      ) : (
        <>
          <IconBtn
            theme={theme}
            name={isWorkingOn ? 'star' : 'star-outline'}
            color={isWorkingOn ? flowStateColor : theme.textMuted}
            onPress={onToggleWorkingOn}
            accessibilityLabel={isWorkingOn ? 'Stop working on' : 'Mark as working on'}
          />
          <IconBtn
            theme={theme}
            name="check"
            color={theme.textSecondary}
            onPress={onComplete}
            accessibilityLabel={`Complete task: ${String(task?.text ?? '')}`}
          />
          <IconBtn
            theme={theme}
            name="trash-can-outline"
            color={theme.textMuted}
            onPress={onDelete}
            accessibilityLabel={`Delete task: ${String(task?.text ?? '')}`}
          />
        </>
      )}
    </View>
  )
}

export function MarkerRow({
  theme,
  marker,
  category,
  flash,
  consecutive,
  spacing = 150,
  onNote,
  onAddBelow,
  onDelete,
  rearranging,
  onToggleRearrange,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: SPACING.sm,
        // desktop .marker-row.consecutive-marker margin-top (BoardScreen
        // parses settings.consecutiveMarkerMargin, default 150px)
        marginTop: consecutive ? spacing : 0
      }}
    >
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.xs,
            backgroundColor: withAlpha(category?.color),
            borderRadius: 20,
            paddingRight: 4
          },
          flash && {
            borderWidth: 2,
            borderColor: FLASH_COLOR,
            backgroundColor: withAlpha(FLASH_COLOR, '4D')
          }
        ]}
        accessibilityLabel={`Category marker: ${String(category?.name ?? '')}`}
      >
        <RearrangeHandle theme={theme} rearranging={rearranging} onToggleRearrange={onToggleRearrange} />
        {rearranging ? (
          <MoveButtons
            theme={theme}
            onUp={onMoveUp}
            onDown={onMoveDown}
            upDisabled={!canMoveUp}
            downDisabled={!canMoveDown}
          />
        ) : (
          <>
            <Pressable
              onPress={onNote}
              android_ripple={{ color: theme.ripple, borderless: true }}
              hitSlop={4}
              style={{ padding: 6 }}
              accessibilityLabel="Category note"
            >
              <Icon name="information-outline" size={15} color={theme.textPrimary} />
            </Pressable>
            <Pressable
              onPress={onNote}
              android_ripple={{ color: theme.ripple, borderless: true }}
              hitSlop={2}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: '600', fontSize: 14, letterSpacing: 0.2 }}>
                /{String(category?.name ?? '')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onAddBelow}
              android_ripple={{ color: theme.ripple, borderless: true }}
              hitSlop={4}
              style={{ paddingHorizontal: 6, paddingVertical: 6 }}
              accessibilityLabel={`Add task below ${String(category?.name ?? '')}`}
            >
              <Icon name="plus" size={17} color={theme.textPrimary} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              android_ripple={{ color: theme.ripple, borderless: true }}
              hitSlop={4}
              style={{ paddingHorizontal: 6, paddingVertical: 6 }}
              accessibilityLabel={`Delete ${String(category?.name ?? '')} marker`}
            >
              <Icon name="close" size={17} color={theme.textPrimary} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

function IconBtn({ theme, name, color, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.ripple, borderless: true, radius: 22 }}
      hitSlop={4}
      style={{ padding: 7, borderRadius: 20 }}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Icon name={name} size={21} color={color} />
    </Pressable>
  )
}

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 6,
    minHeight: 52
  }
})
