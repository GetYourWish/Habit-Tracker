// ui.js — the Android-native component kit.
// Material behavior (ripple, elevation, FAB, bottom navigation, dialogs,
// edge-to-edge safe areas) with the desktop app's aurora-glass skin.
//
// v1.0.7 typography: every text style in the kit now comes from the shared
// TYPE scale (theme.js) — and every control color from the theme object,
// which now actually DEFINES flowState/flowStatePressed (they were missing
// until v1.0.7: the FAB rendered with no background at all, filled buttons
// were transparent with white labels, and text buttons fell back to the
// system default color — unreadable in dark mode).

import React, { useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet
} from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RADIUS, SPACING, TYPE } from '../theme.js'

// App background: ONE solid color following the theme (v1.0.11 — replaced
// the aurora LinearGradient + blob circles with the user's requested solid
// canvas; light = #EEF2FF, dark = #0B0D12, both from theme.js bgCanvas).
export function AppBackground({ theme }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.bgCanvas }]}
    />
  )
}

export function GlassCard({ theme, style, children }) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.glassBorder,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          shadowColor: theme.shadow,
          shadowOpacity: theme.dark ? 0.5 : 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
          elevation: 2
        },
        style
      ]}
    >
      {children}
    </View>
  )
}

export function IconBtn({ name, color, onPress, disabled, size = 22, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(128,128,128,0.25)', borderless: true, radius: 24 }}
      hitSlop={6}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        padding: 8,
        borderRadius: 20
      })}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  )
}

// Material 3 small top app bar on a glass surface
export function TopAppBar({ theme, title, subtitle, actions }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        paddingTop: insets.top + SPACING.xs,
        backgroundColor: theme.surface,
        borderBottomColor: theme.border,
        borderBottomWidth: StyleSheet.hairlineWidth
      }}
    >
      <View
        style={{
          height: 56,
          paddingHorizontal: SPACING.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING.xs
        }}
      >
        <View style={{ flex: 1, marginLeft: SPACING.sm }}>
          <Text style={{ color: theme.textPrimary, ...TYPE.appTitle }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: theme.textMuted, ...TYPE.appSubtitle }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
    </View>
  )
}

// Material 3 navigation bar (bottom) — glass surface, pill indicator
export function BottomNav({ theme, tabs, active, onChange }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderTopColor: theme.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingBottom: insets.bottom,
        flexDirection: 'row'
      }}
    >
      {tabs.map(tab => {
        const isActive = active === tab.key
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            android_ripple={{ color: theme.ripple }}
            style={{ flex: 1, alignItems: 'center', paddingTop: SPACING.sm, paddingBottom: SPACING.sm }}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <View
              style={{
                paddingHorizontal: SPACING.lg,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: isActive ? theme.rowFillSelected : 'transparent'
              }}
            >
              <Icon
                name={isActive ? tab.iconActive || tab.icon : tab.icon}
                size={24}
                color={isActive ? theme.flowState : theme.textMuted}
              />
            </View>
            <Text
              style={{
                fontSize: 11,
                marginTop: 2,
                letterSpacing: 0.4,
                color: isActive ? theme.textPrimary : theme.textMuted,
                fontWeight: isActive ? '700' : '500'
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// Material 3 extended FAB
export function Fab({ theme, label, icon, onPress, bottomInset = 96 }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.25)', radius: 200 }}
      style={({ pressed }) => ({
        position: 'absolute',
        right: SPACING.lg,
        bottom: bottomInset,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        backgroundColor: pressed ? theme.flowStatePressed : theme.flowState,
        borderRadius: RADIUS.fab,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
        shadowColor: theme.shadow,
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6
      })}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Icon name={icon} size={22} color="#ffffff" />
      <Text style={{ color: '#ffffff', ...TYPE.button, fontSize: 15 }}>{label}</Text>
    </Pressable>
  )
}

// Material 3 dialog: scrim + centered 28dp-rounded surface.
// The open/close animation is the Modal's own animationType="fade" — the
// previous hand-rolled Animated.Value here was dead code (never attached to
// any view) and its cleanup crashed under test renderers where the Animated
// mock has no .stop().
export function Dialog({ theme, visible, title, onClose, children, actions, wide }) {
  if (!visible) return null
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}
        onPress={onClose}
      >
        <Pressable
          onPress={e => e.stopPropagation()}
          style={[
            {
              width: '100%',
              maxWidth: wide ? 560 : 400,
              maxHeight: '85%',
              backgroundColor: theme.bgPrimary,
              borderRadius: RADIUS.sheet,
              padding: SPACING.xl
            },
            { shadowColor: theme.shadow, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 }
          ]}
        >
          <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 0.1, marginBottom: SPACING.md }}>
            {title}
          </Text>
          {children}
          {actions ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.xs, marginTop: SPACING.lg }}>
              {actions}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// M3 text button (dialog actions)
export function TextButton({ theme, label, onPress, disabled, destructive }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.ripple, borderless: true }}
      style={({ pressed }) => ({
        paddingHorizontal: SPACING.md,
        paddingVertical: 10,
        borderRadius: RADIUS.md,
        opacity: disabled ? 0.38 : pressed ? 0.8 : 1
      })}
      accessibilityRole="button"
    >
      <Text style={{ color: destructive ? theme.danger : theme.flowState, ...TYPE.button }}>
        {label}
      </Text>
    </Pressable>
  )
}

// M3 filled button
export function FilledButton({ theme, label, icon, onPress, disabled, destructive, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      style={({ pressed }) => [
        {
          flexDirection: icon ? 'row' : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACING.sm,
          backgroundColor: disabled
            ? theme.rowFillSelected
            : destructive
              ? theme.danger
              : theme.flowState,
          borderRadius: RADIUS.xl,
          paddingHorizontal: SPACING.xl,
          paddingVertical: 12,
          opacity: pressed ? 0.85 : 1
        },
        style
      ]}
      accessibilityRole="button"
    >
      {icon ? <Icon name={icon} size={18} color={disabled ? theme.textMuted : '#ffffff'} /> : null}
      <Text style={{ color: disabled ? theme.textMuted : '#ffffff', ...TYPE.button, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  )
}

// Settings row (icon + label + value/control) used by SettingsScreen
export function SettingsRow({ theme, icon, label, hint, control, onPress }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md }}>
      <Icon name={icon} size={22} color={theme.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong }}>{label}</Text>
        {hint ? (
          <Text style={{ color: theme.textMuted, marginTop: 2, ...TYPE.caption }}>{hint}</Text>
        ) : null}
      </View>
      {control}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable onPress={onPress} android_ripple={{ color: theme.ripple }}>
      {body}
    </Pressable>
  )
}

// Segmented control (Material 3 segmented button row) — the desktop's pill
// tab groups (review tabs, range toggles, filter selects) as a compact
// mobile control. Exported from the shared kit because both Settings and
// Reviews use it.
export function Segmented({ theme, options, value, onChange, accessibilityLabel }) {
  return (
    <View
      style={{ flexDirection: 'row', backgroundColor: theme.bgSecondary, borderRadius: 999, padding: 3, gap: 2 }}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map(opt => {
        const selected = value === opt.value
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            android_ripple={{ color: theme.ripple, borderless: true }}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 9,
              borderRadius: 999,
              alignItems: 'center',
              backgroundColor: selected ? theme.bgPrimary : 'transparent',
              elevation: selected ? 1 : 0,
              opacity: pressed && !selected ? 0.7 : 1
            })}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={{
                color: selected ? theme.flowState : theme.textSecondary,
                fontSize: 13.5,
                fontWeight: selected ? '700' : '500',
                letterSpacing: 0.2,
                textAlign: 'center'
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// Transient snackbar pinned above the bottom nav
export function Snackbar({ theme, message, onDone, duration = 2600 }) {
  useEffect(() => {
    if (!message) return undefined
    const t = setTimeout(() => onDone && onDone(), duration)
    return () => clearTimeout(t)
  }, [message, duration, onDone])
  if (!message) return null
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: SPACING.lg,
        right: SPACING.lg,
        bottom: 96,
        backgroundColor: theme.dark ? '#e8e8e8' : '#322f35',
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.lg,
        elevation: 6,
        shadowColor: theme.shadow,
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 }
      }}
    >
      <Text style={{ color: theme.dark ? '#1a1a1a' : '#f0f0f0', fontSize: 13.5, lineHeight: 19 }}>
        {message}
      </Text>
    </View>
  )
}
