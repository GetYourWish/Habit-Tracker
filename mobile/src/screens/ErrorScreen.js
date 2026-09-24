// ErrorScreen — the corrupt-habit.json recovery surface.
//
// Reached only when habit.json exists but cannot be parsed. Before this
// screen appears the store has ALREADY preserved the damaged bytes verbatim
// in the app's private .corrupt/ folder, so every option here is strictly
// non-destructive:
//  - Restore verified copy — the .tracker.tmp.json sibling holds the exact
//    content the app byte-verified during its last write cycle (present
//    when a write was interrupted mid-flight)
//  - Restore latest backup — the app-private .backups/ window; a copy is
//    rotated before EVERY real write, so this is at most one write old
//  - Salvage readable data — structural recovery: every complete value in
//    the file is kept, only entries inside the damaged region are dropped
//  - Reload — re-attempt a plain load (after fixing the file by hand or
//    letting the sync software restore an older copy)
//
// A successful restore flips the store to 'ready' and App renders the
// board again — this screen unmounts itself.

import React, { useState } from 'react'
import { View, Text, ScrollView, Alert } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppBackground, GlassCard, FilledButton, TextButton } from '../components/ui.js'
import { SPACING } from '../theme.js'

function RecoveryAction({ theme, icon, title, hint, onPress, disabled, busy }) {
  return (
    <View style={{ marginTop: SPACING.md }}>
      <FilledButton
        theme={theme}
        label={busy ? 'Working…' : title}
        icon={icon}
        onPress={onPress}
        disabled={disabled || busy}
      />
      {hint ? (
        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 5, lineHeight: 16, textAlign: 'center' }}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

export function ErrorScreen({ theme, state, store }) {
  const insets = useSafeAreaInsets()
  const [busyAction, setBusyAction] = useState(null)
  const [note, setNote] = useState(null)

  const recovery = state.recovery || { sources: {}, corruptSavedName: null }
  const hasTmp = !!recovery.sources.tmp
  const hasBackup = !!recovery.sources.backup

  const run = async (key, fn, successNote) => {
    if (busyAction) return
    setBusyAction(key)
    setNote(null)
    try {
      const result = await fn()
      if (successNote) {
        const detail =
          result && typeof result.droppedBytes === 'number' && result.droppedBytes > 0
            ? ` (${result.droppedBytes} damaged bytes skipped)`
            : ''
        Alert.alert('Recovered', successNote + detail)
      }
      // success → store flips to 'ready' → App shows the board; nothing
      // else to do here (this screen unmounts)
    } catch (e) {
      setNote((e && e.message) || String(e))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bgCanvas }}>
      <AppBackground theme={theme} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: SPACING.lg,
          paddingBottom: insets.bottom + SPACING.xl
        }}
      >
        <GlassCard theme={theme} style={{ padding: SPACING.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm }}>
            <Icon name="file-alert-outline" size={26} color={theme.flowState} />
            <Text
              style={{
                color: theme.textPrimary,
                fontWeight: '700',
                fontSize: 17,
                marginLeft: SPACING.sm
              }}
            >
              Could not load habit.json
            </Text>
          </View>

          <Text style={{ color: theme.textSecondary, fontSize: 13.5, lineHeight: 19 }}>
            {state.errorMessage}
          </Text>

          <Text
            style={{
              color: theme.textMuted,
              fontSize: 12.5,
              lineHeight: 18,
              marginTop: SPACING.md
            }}
          >
            Nothing has been deleted — the damaged file is untouched on disk
            {recovery.corruptSavedName
              ? ` and a verbatim copy was saved as ${recovery.corruptSavedName} in the app's private storage.`
              : '. Pick a recovery option below; every option preserves the damaged copy.'}
          </Text>

          {hasTmp && (
            <RecoveryAction
              theme={theme}
              icon="check-decagram-outline"
              title="Restore last verified copy"
              hint="the exact bytes this app verified during its previous write"
              onPress={() =>
                run('tmp', () => store.restoreFrom('tmp'), 'habit.json restored from the verified copy.')
              }
              busy={busyAction === 'tmp'}
              disabled={busyAction != null}
            />
          )}

          {hasBackup && (
            <RecoveryAction
              theme={theme}
              icon="backup-restore"
              title="Restore latest backup"
              hint={recovery.sources.backup}
              onPress={() =>
                run('backup', () => store.restoreFrom('backup'), 'habit.json restored from the backup.')
              }
              busy={busyAction === 'backup'}
              disabled={busyAction != null}
            />
          )}

          <RecoveryAction
            theme={theme}
            icon="text-box-search-outline"
            title="Salvage readable data"
            hint="keeps every complete entry; entries in the damaged region may be lost"
            onPress={() =>
              run('salvage', () => store.salvageRepair(), 'habit.json salvaged')
            }
            busy={busyAction === 'salvage'}
            disabled={busyAction != null}
          />

          {note && (
            <Text style={{ color: theme.flowState, fontSize: 13, marginTop: SPACING.md, lineHeight: 18 }}>
              {note}
            </Text>
          )}

          <TextButton
            theme={theme}
            label={busyAction ? 'Working…' : 'Try loading again'}
            onPress={() => {
              if (!busyAction) store.load().catch(() => {})
            }}
            disabled={busyAction != null}
          />
        </GlassCard>
      </ScrollView>
    </View>
  )
}
