// Release-mode JS crash reporter.
//
// Why: a release APK has no red box — an unhandled JS error at startup kills
// the process instantly and the user has no console/logcat to check. This
// module records the last fatal JS error to the app-private storage and the
// app shows it on the next launch (screenshot-able, no adb needed).
//
// Design constraints:
//  - __DEV__ is a no-op (Metro/dev builds have real tooling).
//  - Every step is individually try/catch-wrapped: the reporter must never
//    be the reason the app crashes.
//  - The original global handler is still invoked (native crash pipeline,
//    e.g. the JS exception dialog, keeps its normal behavior).
//
// FS import mirrors saf.js: SDK 54+ moved the string API (documentDirectory,
// readAsStringAsync, writeAsStringAsync, getInfoAsync, deleteAsync) to
// 'expo-file-system/legacy' — the ROOT export of SDK 57 has none of them
// (documentDirectory is undefined there and the legacy methods are stubs
// that THROW 'deprecated … will throw in runtime'), which silently killed
// the whole crash reporter: reports were never written, never read, never
// shown. The lazy require keeps this module out of the Node test env.
//
// VERSION is read from the BUNDLED app.json (inlined by Metro at bundle
// time), NOT from the native PackageInfo: the JS bundle and the native
// android project can be out of sync when the apk is rebuilt via gradlew
// alone on a stale prebuild folder — the 2026-09-17 crash report claimed
// "app version: 1.0.1" (stale native versionName) while the JS bundle
// already contained 1.0.4 code. The bundled app.json always identifies the
// code that actually crashed.

import appJson from '../app.json'

const APP_VERSION = appJson.expo.version || 'unknown'

let _fs = null
function legacyFs() {
  if (!_fs) {
    try {
      _fs = require('expo-file-system/legacy') // SDK 54+
    } catch (e) {
      _fs = require('expo-file-system') // older SDKs
    }
  }
  return _fs
}

const CRASH_FILE = 'last-crash.json'
export const MAX_STACK_CHARS = 8000

let cachedReport // undefined = not read yet, null = checked & none

export function crashReportUri() {
  return legacyFs().documentDirectory + CRASH_FILE
}

export function installReleaseCrashReporter() {
  if (__DEV__) return false
  try {
    const errorUtils = global.ErrorUtils
    if (!errorUtils || typeof errorUtils.setGlobalHandler !== 'function') return false
    const original = typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : null
    errorUtils.setGlobalHandler((error, isFatal) => {
      try {
        const report = {
          name: error && error.name ? String(error.name) : 'Error',
          message: error && error.message ? String(error.message) : String(error),
          stack: error && error.stack ? String(error.stack).slice(0, MAX_STACK_CHARS) : null,
          isFatal: !!isFatal,
          version: APP_VERSION,
          at: new Date().toISOString()
        }
        legacyFs()
          .writeAsStringAsync(crashReportUri(), JSON.stringify(report, null, 2))
          .catch(() => {})
      } catch (e) {
        // reporter must never throw
      }
      if (typeof original === 'function') original(error, isFatal)
    })
    return true
  } catch (e) {
    return false
  }
}

export async function readLastCrash() {
  if (cachedReport !== undefined) return cachedReport
  try {
    const info = await legacyFs().getInfoAsync(crashReportUri())
    if (!info.exists) {
      cachedReport = null
      return null
    }
    const raw = await legacyFs().readAsStringAsync(crashReportUri())
    cachedReport = JSON.parse(raw)
  } catch (e) {
    cachedReport = null
  }
  return cachedReport
}

export async function clearLastCrash() {
  cachedReport = null
  try {
    await legacyFs().deleteAsync(crashReportUri(), { idempotent: true })
  } catch (e) {
    // ignore — nothing we can do, and the screen will simply reappear
  }
}
