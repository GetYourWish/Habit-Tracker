// App root — theme resolution, screen switching, bottom navigation.
// Mirrors desktop App.jsx: loading → schema gate → setup → (board | settings).

import React, { useState, useCallback, useEffect } from 'react'
import { View, Text, ActivityIndicator, StyleSheet, StatusBar } from 'react-native'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'
import { buildTheme, SPACING } from './src/theme.js'
import { updateSettings } from './src/actions.js'
import { useTracker } from './src/hooks/useTracker.js'
import { readLastCrash, clearLastCrash } from './src/diagnostics.js'
import { AppBackground, BottomNav } from './src/components/ui.js'
import { BoardScreen } from './src/components/BoardScreen.js'
import { ReviewsScreen } from './src/components/ReviewsScreen.js'
import { SetupScreen, SchemaErrorScreen } from './src/screens/SetupScreen.js'
import { SettingsScreen } from './src/screens/SettingsScreen.js'
import { CrashReportScreen } from './src/screens/CrashReportScreen.js'
import { ErrorScreen } from './src/screens/ErrorScreen.js'
import ErrorBoundary from './src/components/ErrorBoundary.js'
import appJson from './app.json'

// Shown on every loading/error screen so a screenshot identifies the exact
// installed build ("Loading… v1.0.4") — we wasted a whole debugging round
// because there was no way to tell WHICH apk a 'stuck on loading' screenshot
// came from.
const APP_VERSION = appJson.expo.version || ''
const LOADING_TEXT = `Loading… v${APP_VERSION}`

// Root: mounts SafeAreaProvider BEFORE anything calls useSafeAreaInsets.
// Expo's registerRootComponent() registers the component as-is (no provider
// wrapper) — without this, the very first render threw 'No safe area value
// available' and release builds crashed instantly on launch.
// initialWindowMetrics hands the provider the insets measured natively at
// startup so the first frame is already laid out correctly.
export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppShell />
    </SafeAreaProvider>
  )
}

function AppShell() {
  const scheme = useColorScheme()
  const [tab, setTab] = useState('board')
  const [refreshing, setRefreshing] = useState(false)
  // undefined = not checked yet, null = no crash recorded, object = report
  const [crashReport, setCrashReport] = useState(undefined)
  // Optimistic theme: applied the instant the user taps an option so the
  // UI responds immediately; the store write (which takes a full verified
  // SAF write cycle, ~1–2 s on real hardware) lands underneath and then
  // this override clears. Cleared on failure too, so a failed save never
  // leaves a lie on screen.
  const [pendingTheme, setPendingTheme] = useState(null)

  useEffect(() => {
    let alive = true
    readLastCrash().then(report => {
      if (alive) setCrashReport(report)
    })
    return () => {
      alive = false
    }
  }, [])

  const handleCrashDismiss = useCallback(async () => {
    await clearLastCrash()
    setCrashReport(null)
  }, [])

  const { store, state, folderUri, autoSync, booted, pickFolder, setAutoSync, refresh, forgetFolder } = useTracker()

  // theme preference follows data.settings.theme (desktop parity); the
  // optimistic override wins until the write settles
  const savedPreference = state.data?.settings?.theme || 'system'
  const preference = pendingTheme || savedPreference
  const theme = buildTheme(preference, scheme)

  // v1.0.11 light-theme fix: the status-bar LETTERS (clock, battery,
  // notification icons) now follow the APP theme — with edge-to-edge and
  // no explicit barStyle they stayed light-content when the user picked the
  // Light theme, i.e. white system letters on the near-white light canvas.
  const statusBar = (
    <StatusBar
      barStyle={theme.dark ? 'light-content' : 'dark-content'}
      translucent
    />
  )

  // Theme changes apply INSTANTLY (optimistic) and persist through the same
  // serialized, backed-up write cycle as every other mutation. If the write
  // fails the visual override is rolled back and the Settings screen shows
  // the save failure — "it stopped making changes" can never silently
  // happen again.
  const handleThemeChange = useCallback(
    async value => {
      if (value === savedPreference && pendingTheme == null) return
      setPendingTheme(value)
      try {
        await store.mutate((d, now) => updateSettings(d, { theme: value }, now))
        setPendingTheme(null)
      } catch (e) {
        // roll the visual override back and let the caller surface the error
        setPendingTheme(null)
        throw e
      }
    },
    [store, savedPreference, pendingTheme]
  )

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      // keep the indicator visible for a beat so it feels intentional (desktop parity)
      setTimeout(() => setRefreshing(false), 400)
    }
  }, [refresh, refreshing])

  // last session recorded a fatal JS error → show it before anything else
  if (crashReport) {
    return (
      <>
        {statusBar}
        <CrashReportScreen report={crashReport} onDismiss={handleCrashDismiss} />
      </>
    )
  }

  if (!booted) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: '#EEF2FF' }]}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={{ color: '#666666', marginTop: SPACING.md }}>{LOADING_TEXT}</Text>
      </View>
    )
  }

  if (state.status === 'schema-too-new') {
    return (
      <>
        {statusBar}
        <SchemaErrorScreen theme={theme} schemaVersion={state.schemaVersion} />
      </>
    )
  }

  if (state.status === 'no-folder' || state.status === 'missing') {
    const mode = state.status === 'missing' ? 'missing' : folderUri ? 'regrant' : 'fresh'
    return (
      <>
        {statusBar}
        <ErrorBoundary onReloadData={() => store.load()}>
          <SetupScreen
            theme={theme}
            mode={mode}
            folderUri={folderUri}
            errorMessage={state.errorMessage}
            onPickFolder={pickFolder}
            onCreateDefault={async () => {
              await store.initializeDefault()
            }}
            onReload={() => store.load()}
          />
        </ErrorBoundary>
      </>
    )
  }

  if (state.status === 'error') {
    // corrupt habit.json → recovery surface (restore verified copy /
    // latest backup, structural salvage, plain reload). The damaged bytes
    // were already preserved in the app's private .corrupt/ folder by the
    // store before this screen renders — every option is non-destructive.
    return (
      <>
        {statusBar}
        <ErrorBoundary onReloadData={() => store.load()}>
          <ErrorScreen theme={theme} state={state} store={store} />
        </ErrorBoundary>
      </>
    )
  }

  if (state.status === 'loading') {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.bgCanvas }]}>
        {statusBar}
        <AppBackground theme={theme} />
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={{ color: theme.textSecondary, marginTop: SPACING.md }}>{LOADING_TEXT}</Text>
      </View>
    )
  }

  // The main app. ErrorBoundary converts any render error (which in a
  // release build would otherwise KILL THE PROCESS — the remote-reported
  // "create a task / change the theme → crash") into an in-app recovery
  // card; the store underneath keeps every data guarantee.
  return (
    <View style={[styles.fill, { backgroundColor: theme.bgCanvas }]}>
      {statusBar}
      <AppBackground theme={theme} />
      <View style={{ flex: 1 }}>
        <ErrorBoundary onReloadData={() => store.load()}>
          {tab === 'board' ? (
            <BoardScreen
              theme={theme}
              state={state}
              store={store}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onShowConflictInfo={() => setTab('settings')}
            />
          ) : tab === 'reviews' ? (
            <ReviewsScreen theme={theme} state={state} store={store} />
          ) : (
            <SettingsScreen
              theme={theme}
              state={state}
              store={store}
              folderUri={folderUri}
              autoSync={autoSync}
              onSetAutoSync={setAutoSync}
              onPickFolder={pickFolder}
              themeValue={preference}
              onThemeChange={handleThemeChange}
            />
          )}
        </ErrorBoundary>
        <BottomNav
          theme={theme}
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'board', label: 'Board', icon: 'view-dashboard-outline', iconActive: 'view-dashboard' },
            { key: 'reviews', label: 'Reviews', icon: 'chart-bar', iconActive: 'chart-bar' },
            { key: 'settings', label: 'Settings', icon: 'cog-outline', iconActive: 'cog' }
          ]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' }
})
