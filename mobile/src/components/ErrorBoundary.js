// ErrorBoundary — the last line of defense between a render error and a
// dead process.
//
// WHY (remote-reported 2026-09-18: "i cant create a new task without having
// it crash, i cant change the theme without having it crash"): React Native
// release builds have NO error boundary by default — any component that
// throws during render propagates to the root, React unmounts the whole
// tree, and the process dies (the native crash reporter then shows the crash
// report on the next launch). The data on disk is fine — the STORE kept all
// its guarantees — but the user experiences a total crash.
//
// This boundary catches render errors anywhere under AppShell and shows a
// calm, self-contained fallback instead:
//  - what went wrong (error name + message, screenshot-able)
//  - "Try again" — resets the boundary and re-renders the app shell; the
//    store is untouched, so this is always safe
//  - "Reload data" — a full store.load() for the case where the rendered
//    data itself was the problem
// The fallback deliberately uses only plain RN primitives with fixed colors
// (like CrashReportScreen): whatever crashed the app must not be able to
// crash the crash screen.

import React from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SPACING } from '../theme.js'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, tries: 0 }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    // Surface in dev tooling; never rethrow from here.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[ErrorBoundary] render error caught:', error, errorInfo?.componentStack)
    }
    this.lastInfo = errorInfo
  }

  handleRetry = () => {
    this.setState(prev => ({ error: null, tries: prev.tries + 1 }))
  }

  handleReload = () => {
    const { onReloadData } = this.props
    this.setState({ error: null, tries: 0 })
    if (typeof onReloadData === 'function') {
      try {
        const result = onReloadData()
        if (result && typeof result.catch === 'function') result.catch(() => {})
      } catch (e) {
        // a failed reload must never break the retry path
      }
    }
  }

  render() {
    const { error, tries } = this.state
    if (!error) return this.props.children

    const name = (error && error.name) || 'Error'
    const message = (error && error.message) || String(error)
    const componentStack =
      this.lastInfo && this.lastInfo.componentStack ? String(this.lastInfo.componentStack) : ''

    return (
      <View style={styles.fill}>
        <View style={{ height: 44 }} />
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong displaying the app</Text>
          <Text style={styles.subtitle}>
            Your data file was NOT touched — this is a display problem only. Screenshot this
            screen if it keeps happening.
          </Text>
          <ScrollView style={styles.box}>
            <Text style={styles.mono}>
              {name}: {message}
            </Text>
            {componentStack ? <Text style={styles.mono}>{'\n'}{componentStack}</Text> : null}
          </ScrollView>
          <Pressable onPress={this.handleRetry} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          {tries >= 1 ? (
            <Pressable onPress={this.handleReload} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Reload data from disk</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#111827',
    padding: SPACING.lg
  },
  card: {
    flex: 1
  },
  title: { color: '#f9fafb', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  subtitle: { color: '#9ca3af', fontSize: 13.5, lineHeight: 19, marginBottom: SPACING.md },
  box: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md
  },
  mono: { color: '#e5e7eb', fontSize: 12, fontFamily: 'monospace' },
  primaryButton: {
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  secondaryButton: {
    marginTop: SPACING.sm,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  secondaryButtonText: { color: '#c4b5fd', fontWeight: '600', fontSize: 14.5 }
})

export default ErrorBoundary
