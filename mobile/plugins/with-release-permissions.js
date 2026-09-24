/**
 * Local Expo config plugin: strip every permission the RELEASE app does not
 * use.
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
 *                             is embedded; nothing is ever fetched
 *   SYSTEM_ALERT_WINDOW     — RN dev-overlay tooling; nothing draws overlays
 *   VIBRATE                 — nothing vibrates
 *   READ_EXTERNAL_STORAGE   — SAF needs NO storage permissions at all
 *   WRITE_EXTERNAL_STORAGE  — (same; on Android <= 12 these two would even
 *                             show up as "storage" permission grants)
 *
 * All five are pure template baggage for this app.
 *
 * How: a RELEASE-variant manifest overlay at
 *   android/app/src/release/AndroidManifest.xml
 * with `tools:node="remove"` on each permission. The Android manifest merger
 * applies variant source sets only to that variant, so:
 *   - RELEASE: merged manifest has none of the five permissions
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

/**
 * Compose the release-variant AndroidManifest.xml contents. Pure string
 * function so it can be unit-tested without running a manifest merge.
 */
function composeReleaseManifest(permissions) {
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
  const contents = composeReleaseManifest(RELEASE_PERMISSIONS_TO_STRIP)
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
          ' permissions stripped from release): ' +
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
module.exports.TAG = TAG
