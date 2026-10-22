/**
 * Local Expo config plugin: strip every permission the RELEASE app does not
 * use — and keep the (few) it does.
 *
 * Why (user-reported 2026-09-17): "why does the app have network access
 * permissions? we did not build an app that requires the internet at all —
 * the habit.json file is synced between devices by OTHER software
 * (Syncthing); the app itself only reads and writes it locally."
 *
 * He is right. The Expo bare template's main AndroidManifest.xml ships a
 * generic permission set:
 *
 *   INTERNET                — no network code exists in this app; the bundle
 *                             is embedded; nothing is ever fetched. The
 *                             2026-10-22 round hardened this further on the
 *                             desktop side too (electron/netlock.cjs) — both
 *                             apps are now structurally offline.
 *   SYSTEM_ALERT_WINDOW     — RN dev-overlay tooling; nothing draws overlays
 *   VIBRATE                 — nothing uses the Vibrator API (notification
 *                             channel vibration does not need it)
 *   READ_EXTERNAL_STORAGE   — SAF needs NO storage permissions at all
 *   WRITE_EXTERNAL_STORAGE  — (same; on Android <= 12 these two would even
 *                             show up as "storage" permission grants)
 *
 * All five stay pure template baggage for this app and keep being stripped
 * from RELEASE — INTERNET above all: with it removed the app cannot open a
 * socket even if some future dependency tried to.
 *
 * 2026-10-22 — the notification system (expo-notifications, LOCAL reminders
 * only) introduced permissions that MUST survive the strip:
 *   POST_NOTIFICATIONS       — declared by the expo-notifications library
 *                              manifest; merged into every variant. Android
 *                              13+ reminders are invisible without it.
 *   RECEIVE_BOOT_COMPLETED   — also from the library manifest; re-registers
 *                              the scheduled reminder alarms after a reboot.
 * Neither is in the strip list, so the release overlay leaves them in place.
 * The library also registers an inert FCM push receiver — without Firebase
 * configuration and without INTERNET it can never do anything.
 *
 * In addition the release overlay now DECLARES the exact-alarm pair, so
 * reminders fire on time instead of "sometime within the Doze window":
 *   USE_EXACT_ALARM          — Android 13+; auto-granted, exactly what a
 *                              user-scheduled reminder app is for
 *   SCHEDULE_EXACT_ALARM     — Android 12; granted by default on 12
 * On devices where neither is granted the scheduling library gracefully
 * falls back to inexact alarms (reminders still fire, slightly later).
 *
 * How: a RELEASE-variant manifest overlay at
 *   android/app/src/release/AndroidManifest.xml
 * with `tools:node="remove"` on each stripped permission. The Android manifest
 * merger applies variant source sets only to that variant, so:
 *   - RELEASE: merged manifest has none of the five stripped permissions
 *   - DEBUG:   untouched (main manifest keeps INTERNET etc. — Metro/dev
 *              server tooling may need it; dev builds are never shipped)
 *
 * Deliberately NOT removed: the
 *   <app-package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
 * entry that shows up in permission inspector apps. That one is INJECTED by
 * androidx-core when a library registers a runtime broadcast receiver with
 * RECEIVER_NOT_EXPORTED (required on API 33+; RN/expo do this at startup).
 * It is a self-defined, signature-level marker that grants this app nothing
 * and other apps nothing — removing it can crash receiver registration. It
 * is not a permission the app "requests"; there is no way to opt out.
 *
 * Idempotent: the overlay is fully rewritten on every prebuild (prebuild
 * --clean regenerates android/ from the template anyway).
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-release-permissions]';

// Every permission stripped from the RELEASE build. Order is kept stable so
// the generated file (and its unit-test golden assertions) never churn.
const RELEASE_PERMISSIONS_TO_STRIP = [
  'android.permission.INTERNET',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
];

// Exact-alarm permissions DECLARED by the release overlay for the local
// reminder system (see file header). Android 12+; harmless below.
const RELEASE_PERMISSIONS_TO_DECLARE = [
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM'
];

/**
 * Compose the release-variant AndroidManifest.xml contents. Pure string
 * function so it can be unit-tested without running a manifest merge.
 */
function composeReleaseManifest(permissions, declare) {
  const lines = [
    '<!-- ' + TAG + ' (mobile/plugins/with-release-permissions.js) -->',
    '<!-- Variant overlay: applies to RELEASE builds only. tools:node="remove"',
    '     strips each permission from the merged RELEASE manifest; the debug',
    '     variant keeps them (Metro / dev-server tooling). -->',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '    xmlns:tools="http://schemas.android.com/tools">',
    '',
    '    <!-- This app is fully offline: habit.json is synced by SEPARATE',
    '         software (Syncthing) and is read/written locally through SAF.',
    '         None of the permissions below are used by a release build. -->'
  ]
  for (const p of permissions) {
    lines.push('    <uses-permission android:name="' + p + '" tools:node="remove"/>')
  }
  lines.push('')
  lines.push('    <!-- LOCAL habit reminders (expo-notifications, 2026-10-22):')
  lines.push('         exact alarms so a reminder set for 08:00 fires at 08:00.',
    '         POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED arrive via the',
    '         library manifest and are deliberately NOT stripped above. -->')
  for (const p of declare === undefined ? RELEASE_PERMISSIONS_TO_DECLARE : declare) {
    lines.push('    <uses-permission android:name="' + p + '"/>')
  }
  lines.push('</manifest>')
  return lines.join('\n') + '\n'
}

/**
 * Ensure android/app/src/release/AndroidManifest.xml exists with the
 * removal overlay (creates the release/ source set directory if missing).
 */
function ensureReleaseManifest(androidProjectDir) {
  const releaseDir = path.join(androidProjectDir, 'app', 'src', 'release')
  const manifestPath = path.join(releaseDir, 'AndroidManifest.xml')
  fs.mkdirSync(releaseDir, { recursive: true })
  const contents = composeReleaseManifest(RELEASE_PERMISSIONS_TO_STRIP, RELEASE_PERMISSIONS_TO_DECLARE)
  fs.writeFileSync(manifestPath, contents, 'utf8')
  return manifestPath
}

const withReleasePermissions = config => {
  return withDangerousMod(config, [
    'android',
    async config => {
      // same path resolution the sibling plugins use (platformProjectPath is
      // not populated for every mod invocation)
      const androidRoot = path.join(config.modRequest.projectRoot, 'android')
      if (!fs.existsSync(androidRoot)) {
        console.warn(TAG + ': android/ project not found — skipping (unexpected).')
        return config
      }
      const manifestPath = ensureReleaseManifest(androidRoot)
      console.log(
        TAG + ': release manifest overlay written (' +
          RELEASE_PERMISSIONS_TO_STRIP.length +
          ' permissions stripped, ' +
          RELEASE_PERMISSIONS_TO_DECLARE.length +
          ' exact-alarm permissions declared for local reminders): ' +
          manifestPath
      )
      return config
    }
  ])
}

module.exports = withReleasePermissions
module.exports.withReleasePermissions = withReleasePermissions
module.exports.composeReleaseManifest = composeReleaseManifest
module.exports.ensureReleaseManifest = ensureReleaseManifest
module.exports.RELEASE_PERMISSIONS_TO_STRIP = RELEASE_PERMISSIONS_TO_STRIP
module.exports.RELEASE_PERMISSIONS_TO_DECLARE = RELEASE_PERMISSIONS_TO_DECLARE
module.exports.TAG = TAG
