// SettingsScreen — lean habit-app settings (desktop Settings.jsx parity):
// Data, Appearance, Calendar, About. The task-era sections (difficulties,
// scoring, dashboard cards, logs, priority multipliers) are gone with the
// task model. Every write goes through store.mutate → rebase → verified
// write, so settings edits sync to the desktop like any other mutation.

import React, { useState } from 'react'
import { View, Text, ScrollView, Switch, Pressable, Share } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { TopAppBar, GlassCard, SettingsRow, Segmented, Snackbar } from '../components/ui.js'
import { updateSettings } from '../actions.js'
import { SPACING, TYPE } from '../theme.js'
import appJson from '../../app.json'

const APP_VERSION = appJson.expo.version || ''

function SectionCard({ theme, title, children }) {
  return (
    <GlassCard theme={theme} style={{ padding: SPACING.lg, marginBottom: SPACING.md }}>
      <Text style={{ color: theme.textSecondary, ...TYPE.sectionTitle, marginBottom: SPACING.sm }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </GlassCard>
  )
}

export function SettingsScreen({
  theme,
  state,
  store,
  folderUri,
  autoSync,
  onSetAutoSync,
  onPickFolder,
  themeValue,
  onThemeChange
}) {
  const [busy, setBusy] = useState(false)
  const [snack, setSnack] = useState('')

  const data = state.data
  const settings = (data && data.settings) || {}
  const weekStartsOn = settings.weekStartsOn ?? 1

  const setWeekStart = value => {
    store
      .mutate((d, now) => updateSettings(d, { weekStartsOn: Number(value) }, now))
      .catch(() => setSnack('Could not save the setting'))
  }

  const backupNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await store.backupNow()
      setSnack(result && result.path ? `Backup saved: ${result.path}` : 'Backup created')
    } catch (e) {
      setSnack('Backup failed: ' + (e && e.message ? e.message : 'unknown error'))
    } finally {
      setBusy(false)
    }
  }

  const shareFolder = async () => {
    try {
      if (folderUri) await Share.share({ message: folderUri })
    } catch (e) {
      // sharing cancelled — not an error worth surfacing
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopAppBar theme={theme} title="Settings" subtitle={`v${APP_VERSION}`} />
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 110 }}>
        {/* ---- Data ---- */}
        <SectionCard theme={theme} title="Data">
          <SettingsRow
            theme={theme}
            icon="folder-outline"
            label="Sync folder"
            hint={folderUri ? 'Your habit.json lives in this folder' : 'No folder picked yet'}
            control={
              folderUri ? (
                <Pressable onPress={shareFolder} accessibilityLabel="Share folder path" accessibilityRole="button" hitSlop={8}>
                  <Icon name="share-outline" size={20} color={theme.flowState} />
                </Pressable>
              ) : null
            }
          />
          {folderUri ? (
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 11.5,
                lineHeight: 16,
                marginBottom: SPACING.sm,
                marginTop: -4
              }}
              numberOfLines={2}
            >
              {folderUri}
            </Text>
          ) : null}
          <SettingsRow
            theme={theme}
            icon="folder-swap-outline"
            label="Change sync folder"
            hint="Pick a different folder for habit.json"
            onPress={() => onPickFolder()}
          />
          <SettingsRow
            theme={theme}
            icon="backup-restore"
            label={busy ? 'Backing up…' : 'Backup now'}
            hint="Copy the current habit.json into .backups"
            onPress={backupNow}
          />
          <SettingsRow
            theme={theme}
            icon="autorenew"
            label="Auto-sync"
            hint="Reload habit.json when the folder changes (Syncthing)"
            control={
              <Switch
                value={autoSync}
                onValueChange={onSetAutoSync}
                trackColor={{ true: theme.flowState, false: theme.rowFillSelected }}
                thumbColor="#ffffff"
                accessibilityLabel="Auto sync"
              />
            }
          />
        </SectionCard>

        {/* ---- Appearance ---- */}
        <SectionCard theme={theme} title="Appearance">
          <Text style={{ color: theme.textSecondary, ...TYPE.caption, marginBottom: SPACING.sm }}>
            Light, dark, or follow your system setting.
          </Text>
          <Segmented
            theme={theme}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' }
            ]}
            value={themeValue || 'system'}
            onChange={onThemeChange}
            accessibilityLabel="Theme"
          />
        </SectionCard>

        {/* ---- Calendar ---- */}
        <SectionCard theme={theme} title="Calendar">
          <Text style={{ color: theme.textSecondary, ...TYPE.caption, marginBottom: SPACING.sm }}>
            Used by streak and weekly-goal math.
          </Text>
          <Segmented
            theme={theme}
            options={[
              { label: 'Monday', value: 1 },
              { label: 'Sunday', value: 0 }
            ]}
            value={weekStartsOn}
            onChange={setWeekStart}
            accessibilityLabel="Week starts on"
          />
        </SectionCard>

        {/* ---- About ---- */}
        <SectionCard theme={theme} title="About">
          <Text style={{ color: theme.textSecondary, ...TYPE.secondary, lineHeight: 21 }}>
            Habit Tracker — a local-first habit app. Everything lives in one habit.json you can
            sync between devices (Syncthing works great). Habits can repeat as often as you
            like — once a day, twice a day with a best time for each occurrence, every other
            day, weekly, monthly…
          </Text>
          <View style={{ marginTop: SPACING.md }}>
            <SettingsRow
              theme={theme}
              icon="code-json"
              label="Schema version"
              control={
                <Text style={{ color: theme.textSecondary, ...TYPE.bodyStrong }}>
                  {(data && data.schemaVersion) ?? 1}
                </Text>
              }
            />
          </View>
        </SectionCard>
      </ScrollView>

      <Snackbar theme={theme} message={snack} onDone={() => setSnack('')} />
    </View>
  )
}
