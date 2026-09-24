// SetupScreen — Android equivalent of desktop SetupScreen.jsx.
// States:
//  - fresh start: pick the Syncthing folder (SAF tree picker)
//  - folder picked but habit.json missing: Syncthing has not delivered the
//    file yet (or the wrong folder was picked) — the app re-checks on its
//    own every 15 s, plus manual "Check again" and "Create default" options
//  - persisted folder permission lost (reboot/standby): re-grant access

import React, { useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppBackground, GlassCard, FilledButton } from '../components/ui.js'
import { SPACING, RADIUS, TYPE } from '../theme.js'
import appJson from '../../app.json'

// Build marker in the setup screen footer — a screenshot of any pre-board
// screen must identify the exact installed apk version.
const VERSION = appJson.expo.version || ''

export function SetupScreen({ theme, mode, folderUri, errorMessage, onPickFolder, onCreateDefault, onReload }) {
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handlePick() {
    setBusy(true)
    setError(null)
    try {
      await onPickFolder()
    } catch (e) {
      setError('Failed to open the folder picker: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      await onCreateDefault()
    } catch (e) {
      setError('Failed to create habit.json: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const headline =
    mode === 'missing'
      ? 'No habit.json in this folder'
      : mode === 'regrant'
        ? 'Folder access needs to be re-granted'
        : 'Welcome to Habit Tracker'

  const description =
    mode === 'missing'
      ? 'The folder you picked has no habit.json in it yet. That file lives on your PC (the desktop app\u2019s data folder) and reaches this phone through Syncthing — if the first sync has not finished, the file is simply not here yet. Once it arrives this app picks it up on its own within ~15 seconds, or tap "Check again" after Syncthing shows the folder as up to date. Picked the wrong folder? Choose a different one below.'
      : mode === 'regrant'
        ? (errorMessage || 'Android revoked access to the data folder.') +
          '\n\nRe-select your Syncthing folder to continue. Your data was not modified.'
        : 'All your tasks and history live in a single habit.json file inside your Syncthing folder — the same file the desktop app uses. Pick that folder to begin.'

  return (
    <View style={{ flex: 1, backgroundColor: theme.bgCanvas }}>
      <AppBackground theme={theme} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: SPACING.xl,
          paddingTop: insets.top + SPACING.xl,
          paddingBottom: insets.bottom + SPACING.xl
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: SPACING.xl }}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 24,
              backgroundColor: theme.glassBg,
              borderColor: theme.glassBorder,
              borderWidth: 1,
              alignItems: 'center',
              justifyContent: 'center',
              elevation: 3
            }}
          >
            <Icon name="chart-bar" size={44} color={theme.flowState} />
          </View>
          <Text style={{ color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginTop: SPACING.lg, textAlign: 'center' }}>
            Habit Tracker
          </Text>
        </View>

        <GlassCard theme={theme} style={{ padding: SPACING.xl }}>
          <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 0.1, marginBottom: SPACING.sm }}>
            {headline}
          </Text>
          <Text style={{ color: theme.textSecondary, ...TYPE.body, marginBottom: SPACING.lg }}>
            {description}
          </Text>

          {busy ? (
            <ActivityIndicator color={theme.flowState} style={{ padding: SPACING.md }} />
          ) : (
            <View style={{ gap: SPACING.md }}>
              <FilledButton theme={theme} label={mode === 'regrant' ? 'Re-grant folder access' : 'Choose Syncthing folder'} onPress={handlePick} />
              {mode === 'missing' ? (
                <>
                  <FilledButton theme={theme} label="Check again" onPress={onReload} />
                  <FilledButton theme={theme} label="Create default habit.json" onPress={handleCreate} />
                </>
              ) : null}
              {mode === 'regrant' ? (
                <FilledButton theme={theme} label="Retry loading" onPress={onReload} />
              ) : null}
            </View>
          )}

          {(error || (mode !== 'missing' && errorMessage)) ? (
            <Text style={{ color: theme.danger, ...TYPE.secondary, marginTop: SPACING.md }}>
              {error || errorMessage}
            </Text>
          ) : null}
        </GlassCard>

        {folderUri ? (
          <Text
            numberOfLines={2}
            style={{ color: theme.textMuted, fontSize: 12, marginTop: SPACING.lg, textAlign: 'center' }}
          >
            Folder: {folderUri}
          </Text>
        ) : null}
        <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: SPACING.md, textAlign: 'center' }}>
          {`v${VERSION}`}
        </Text>
      </ScrollView>
    </View>
  )
}

// Data file written by a NEWER app version (schemaVersion > 1) — desktop
// shows the same dedicated screen; the file is never modified.
export function SchemaErrorScreen({ theme, schemaVersion }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: theme.bgCanvas }}>
      <AppBackground theme={theme} />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SPACING.xl,
          paddingTop: insets.top
        }}
      >
        <GlassCard theme={theme} style={{ padding: SPACING.xl, borderRadius: RADIUS.lg }}>
          <View style={{ alignItems: 'center', gap: SPACING.md }}>
            <Icon name="file-alert-outline" size={48} color={theme.danger} />
            <Text style={{ color: theme.textPrimary, fontSize: 19, fontWeight: '700', textAlign: 'center' }}>
              Data file is from a newer version
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14.5, lineHeight: 21, textAlign: 'center' }}>
              This habit.json uses schemaVersion {schemaVersion}, but this app supports schemaVersion 1.
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14.5, lineHeight: 21, textAlign: 'center' }}>
              The file was not modified. Update this app to a version that supports schema {schemaVersion}.
            </Text>
          </View>
        </GlassCard>
      </View>
    </View>
  )
}
