// CrashReportScreen — shown instead of the app UI when the previous session
// recorded a fatal JS error (release builds only; see src/diagnostics.js).
// Deliberately dependency-free (plain RN primitives, fixed dark palette):
// whatever crashed the app must not break this screen too.

import React from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native'

export function CrashReportScreen({ report, onDismiss }) {
  const meta = [
    report.version ? `app version (js bundle): v${report.version}` : null,
    report.at ? `at: ${report.at}` : null,
    report.isFatal ? 'fatal: yes' : 'fatal: no'
  ].filter(Boolean)
  const body = [
    report.name ? String(report.name) : 'Error',
    report.message ? String(report.message) : '',
    '',
    meta.join('\n'),
    '',
    report.stack ? String(report.stack) : '(no stack available)'
  ].join('\n')

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>The app hit an error last time</Text>
      <Text style={styles.subtitle}>
        Screenshot this screen and send it — it says exactly what went wrong.
      </Text>
      <ScrollView style={styles.box}>
        <Text style={styles.mono}>{body}</Text>
      </ScrollView>
      <Pressable onPress={onDismiss} style={styles.button}>
        <Text style={styles.buttonText}>Continue to the app</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#111827', padding: 24, paddingTop: 64 },
  title: { color: '#f9fafb', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#9ca3af', fontSize: 14, marginBottom: 16 },
  box: { flex: 1, backgroundColor: '#1f2937', borderRadius: 12, padding: 12 },
  mono: { color: '#e5e7eb', fontSize: 12, fontFamily: 'monospace' },
  button: {
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16
  },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 }
})
