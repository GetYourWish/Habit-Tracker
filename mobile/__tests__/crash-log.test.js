// Unit tests for mobile/plugins/with-crash-log.js
//
// The plugin installs on-device crash logging so that a release build which
// dies instantly (release has NO red error screen) still produces a readable
// crash report on the phone:
//   1. CrashLogProvider.kt (ContentProvider, initialized before
//      Application.onCreate) installs an UncaughtExceptionHandler that
//      writes Downloads/habit-tracker-crash-*.txt (Android 10+) plus an
//      app-private copy, then chains to the previous handler.
//   2. AndroidManifest.xml gets the <provider> registration.
//
// All surgery is pure string work, so it is tested directly.

const {
  composeProviderKotlin,
  composeProviderManifestEntry,
  patchAndroidManifest,
  TAG,
  PROVIDER_CLASS
} = require('../plugins/with-crash-log')

// Excerpt of the Expo SDK 57 template AndroidManifest.xml (the parts the
// plugin touches), kept close to the real thing on purpose.
const MANIFEST_EXCERPT = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:name=".MainApplication" android:label="@string/app_name" android:icon="@mipmap/ic_launcher">
    <meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/>
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`

describe('with-crash-log plugin', () => {
  describe('patchAndroidManifest on a fresh template', () => {
    let patched
    beforeEach(() => {
      patched = patchAndroidManifest(MANIFEST_EXCERPT)
    })

    test('registers the provider exactly once, inside <application>', () => {
      const { contents, added } = patched
      expect(added).toBe(true)
      const occurrences = contents.split(PROVIDER_CLASS).length - 1
      expect(occurrences).toBe(1)
      // the <provider> element must sit before </application>
      const providerIdx = contents.indexOf('<provider')
      const closeIdx = contents.indexOf('</application>')
      expect(providerIdx).toBeGreaterThan(-1)
      expect(providerIdx).toBeLessThan(closeIdx)
    })

    test('provider is not exported (no outside app can reach it)', () => {
      expect(patched.contents).toContain('android:exported="false"')
    })

    test('authority uses the ${applicationId} AGP placeholder, kept LITERAL', () => {
      // must survive as literal text for AGP to resolve — if JS interpolation
      // ate it the build would fail with an empty/blank authority
      expect(patched.contents).toContain('android:authorities="${applicationId}.crashlog"')
    })

    test('is idempotent — second run is a no-op with unchanged contents', () => {
      const second = patchAndroidManifest(patched.contents)
      expect(second.added).toBe(false)
      expect(second.contents).toBe(patched.contents)
    })

    test('throws a clear error when the template no longer matches', () => {
      expect(() => patchAndroidManifest('<manifest></manifest>')).toThrow(
        /<\/application> not found/
      )
    })
  })

  describe('composeProviderKotlin', () => {
    const source = composeProviderKotlin('com.getyourwish.performancetracker')

    test('declares the correct package', () => {
      expect(source).toContain('package com.getyourwish.performancetracker')
    })

    test('installs an uncaught-exception handler and chains to the previous one', () => {
      expect(source).toContain('Thread.setDefaultUncaughtExceptionHandler')
      expect(source).toContain('previous?.uncaughtException(thread, throwable)')
    })

    test('writes a user-visible report into Downloads via MediaStore (Android 10+)', () => {
      expect(source).toContain('MediaStore.Downloads.EXTERNAL_CONTENT_URI')
      expect(source).toContain('Build.VERSION_CODES.Q')
      expect(source).toContain('habit-tracker-crash-')
    })

    test('also writes an app-private copy and IS_PENDING protocol', () => {
      expect(source).toContain('writeAppPrivate')
      expect(source).toContain('MediaStore.Downloads.IS_PENDING')
    })

    test('report contains app version, device info and full stack trace', () => {
      expect(source).toContain('app version: ')
      expect(source).toContain('Build.MANUFACTURER')
      expect(source).toContain('throwable.printStackTrace(PrintWriter(sw))')
    })

    test('every diagnostic step is guarded so logging can never crash the app', () => {
      // 7 guarded blocks: handler body, provider onCreate, version lookup,
      // app-private write, downloads write, output-stream write + delete cleanup
      expect(source.match(/catch \(ignored\w*: Throwable\)/g)?.length).toBeGreaterThanOrEqual(7)
    })

    test('contains no JS/Kotlin interpolation hazards', () => {
      expect(source).not.toContain('`')
      expect(source).not.toContain('${')
    })

    test('provider class name matches the manifest registration', () => {
      expect(source).toContain('class ' + PROVIDER_CLASS + ' : ContentProvider()')
      expect(composeProviderManifestEntry()).toContain('android:name=".' + PROVIDER_CLASS + '"')
    })
  })

  describe('TAG', () => {
    test('is namespaced for build-log grepping', () => {
      expect(TAG).toBe('[with-crash-log]')
    })
  })
})
