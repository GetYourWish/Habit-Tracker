// Unit tests for mobile/plugins/with-offline-manifest.js
//
// The plugin answers the user's 2026-10-22 round-2 report: "the app still
// uses network … this app should not use any internet permissions at all."
// The previous release-only strip left the DEBUG variant (which the user
// also installs — debug builds are standalone, see with-standalone-release)
// with INTERNET + cleartext traffic. The new plugin removes every network
// permission, flag and network-named component from EVERY variant, via two
// stages that match expo's mod pipeline:
//   stage A (dangerous mod, raw template):  patchMainManifest string surgery
//   stage B (withAndroidManifest, LAST):    parsed-tree surgery that undoes
//     what expo-notifications re-adds after stage A (FCM meta-data)

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  patchMainManifest,
  stripPermissionLines,
  stripMetaData,
  stripHttpsQueriesBlock,
  composeOfflinePermissionBlock,
  composeFcmRemovalBlock,
  removeFirebaseMetaData,
  removeHttpsQueries,
  composeCleanVariantOverlay,
  ensureCleanVariantOverlay,
  removeReleaseOverlay,
  PERMISSIONS_TO_REMOVE,
  PERMISSIONS_TO_DECLARE,
  FCM_SERVICE_FQCN,
  FIREBASE_META_KEYS,
  INTERNET_REMOVE_MARKER,
  TAG
} = require('../plugins/with-offline-manifest')

// The RAW template shape the dangerous mod actually sees (expo-template-
// bare-minimum, kept in sync by @expo/config-plugins withAndroidBaseMods):
// comments inside the queries block, space-padded self-closing tags, a
// package= attribute, 4-space child indents. This is what the regex
// surgery must survive. Then the androidManifest chain re-serializes it
// (comments dropped, alphabetical sort) — stage B must survive THAT shape
// too, so both fixtures are exercised below.
const RAW_TEMPLATE_MANIFEST = [
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools" package="com.getyourwish.habittracker">',
  '',
  '    <uses-permission android:name="android.permission.INTERNET"/>',
  '    <!-- OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED -->',
  '    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
  '    <uses-permission android:name="android.permission.VIBRATE"/>',
  '    <!-- These require runtime permissions on M -->',
  '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"/>',
  '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"/>',
  '    <!-- END OPTIONAL PERMISSIONS -->',
  '',
  '    <queries>',
  '      <!-- Support checking for http(s) links via the Linking API -->',
  '      <intent>',
  '        <action android:name="android.intent.action.VIEW" />',
  '        <category android:name="android.intent.category.BROWSABLE" />',
  '        <data android:scheme="https" />',
  '      </intent>',
  '    </queries>',
  '',
  '    <application android:name=".MainApplication" android:label="@string/app_name" android:allowBackup="false" android:theme="@style/AppTheme">',
  '      <activity android:name=".MainActivity" android:exported="true" />',
  '    </application>',
  '  </manifest>'
].join('\n') + '\n'

// The POST-SERIALIZATION shape (what a second, non-clean prebuild would
// read back): no comments, 2-space indent, tight self-closing tags — the
// form stage A must ALSO be idempotent against.
const SERIALIZED_TEMPLATE_MANIFEST = [
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
  '  <uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>',
  '  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>',
  '  <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>',
  '  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>',
  '  <uses-permission android:name="android.permission.USE_EXACT_ALARM"/>',
  '  <uses-permission android:name="android.permission.VIBRATE" tools:node="remove"/>',
  '  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>',
  '  <application android:name=".MainApplication">',
  '    <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/notification_icon_color"/>',
  '    <meta-data android:name="expo.modules.notifications.default_notification_color" android:resource="@color/notification_icon_color"/>',
  '    <service android:name="' + FCM_SERVICE_FQCN + '" tools:node="remove"/>',
  '    <activity android:name=".MainActivity" android:exported="true"/>',
  '  </application>',
  '</manifest>'
].join('\n') + '\n'

describe('with-offline-manifest plugin', () => {
  describe('static policy tables', () => {
    test('removes exactly the five unused permissions — INTERNET first', () => {
      expect(PERMISSIONS_TO_REMOVE).toEqual([
        'android.permission.INTERNET',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE'
      ])
    })

    test('declares the exact-alarm pair for the local reminder system', () => {
      expect(PERMISSIONS_TO_DECLARE).toEqual([
        'android.permission.USE_EXACT_ALARM',
        'android.permission.SCHEDULE_EXACT_ALARM'
      ])
    })

    test('targets the expo-notifications FCM service by its merged name', () => {
      expect(FCM_SERVICE_FQCN).toBe('expo.modules.notifications.service.ExpoFirebaseMessagingService')
    })
  })

  describe('stage A — patchMainManifest on the RAW template', () => {
    let patched
    beforeAll(() => {
      patched = patchMainManifest(RAW_TEMPLATE_MANIFEST)
    })

    test('deletes all five direct permission declarations', () => {
      for (const p of PERMISSIONS_TO_REMOVE) {
        const occurrences = patched.split('"' + p + '"').length - 1
        expect(occurrences).toBe(1)
        expect(patched).toContain('<uses-permission android:name="' + p + '" tools:node="remove"/>')
      }
    })

    test('INTERNET cannot come back: remove marker beats library manifests', () => {
      expect(patched).toContain(INTERNET_REMOVE_MARKER)
    })

    test('declares the exact-alarm pair in main (reminders work in debug installs too)', () => {
      expect(patched).toContain('<uses-permission android:name="android.permission.USE_EXACT_ALARM"/>')
      expect(patched).toContain('<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>')
    })

    test('drops the https-browsable queries block entirely (comment inside included)', () => {
      expect(patched).not.toContain('<queries>')
      expect(patched).not.toContain('</queries>')
      expect(patched).not.toContain('android.intent.category.BROWSABLE')
      expect(patched).not.toContain('android:scheme="https"')
      expect(patched).not.toContain('Support checking for http(s) links')
    })

    test('pulls the FCM service out of the merge from inside <application>', () => {
      expect(patched).toContain(
        '<service android:name="' + FCM_SERVICE_FQCN + '" tools:node="remove"/>'
      )
      const applicationOpen = patched.indexOf('<application')
      const serviceMarker = patched.indexOf('<service android:name="' + FCM_SERVICE_FQCN)
      const applicationClose = patched.indexOf('</application>')
      expect(applicationOpen).toBeGreaterThanOrEqual(0)
      expect(serviceMarker).toBeGreaterThan(applicationOpen)
      expect(serviceMarker).toBeLessThan(applicationClose)
    })

    test('keeps the app intact: application and activity survive', () => {
      expect(patched).toContain('<application')
      expect(patched).toContain('.MainActivity')
      expect(patched.trim().endsWith('</manifest>')).toBe(true)
      expect(patched.split('<manifest').length - 1).toBe(1)
    })

    test('declares the tools namespace the remove markers need', () => {
      expect(patched).toContain('xmlns:tools="http://schemas.android.com/tools"')
    })
  })

  describe('stage A idempotency (both shapes)', () => {
    test('raw template: patching twice equals patching once', () => {
      const once = patchMainManifest(RAW_TEMPLATE_MANIFEST)
      expect(patchMainManifest(once)).toBe(once)
    })

    test('serialized form: no duplicate markers are inserted', () => {
      const once = patchMainManifest(SERIALIZED_TEMPLATE_MANIFEST)
      expect(once.split(INTERNET_REMOVE_MARKER).length - 1).toBe(1)
      expect(once.split('<service android:name="' + FCM_SERVICE_FQCN).length - 1).toBe(1)
      // stage A strips the firebase meta-data too (belt and braces with stage B)
      expect(once).not.toContain('com.google.firebase.messaging')
      // the local notification meta-data survives
      expect(once).toContain('expo.modules.notifications.default_notification_color')
      // pass 2 is a byte-identical no-op
      expect(patchMainManifest(once)).toBe(once)
    })

    test('fails loudly when the template layout changes upstream', () => {
      expect(() => patchMainManifest('this is not a manifest')).toThrow(TAG)
    })
  })

  describe('stage B — parsed-tree surgery (withAndroidManifest, runs last)', () => {
    // xml2js shape: what modResults actually looks like
    const parsedManifest = () => ({
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        application: [{
          $: { 'android:name': '.MainApplication' },
          'meta-data': [
            { $: { 'android:name': 'com.google.firebase.messaging.default_notification_color', 'android:resource': '@color/notification_icon_color' } },
            { $: { 'android:name': 'com.google.firebase.messaging.default_notification_icon', 'android:resource': '@drawable/notification_icon' } },
            { $: { 'android:name': 'expo.modules.notifications.default_notification_color', 'android:resource': '@color/notification_icon_color' } },
            { $: { 'android:name': 'expo.modules.notifications.default_notification_icon', 'android:resource': '@drawable/notification_icon' } },
            { $: { 'android:name': 'expo.modules.updates.ENABLED', 'android:value': 'false' } }
          ],
          service: [{ $: { 'android:name': FCM_SERVICE_FQCN, 'tools:node': 'remove' } }],
          activity: [{ $: { 'android:name': '.MainActivity' } }]
        }],
        queries: [{
          intent: [{
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
            data: [{ $: { 'android:scheme': 'https' } }]
          }]
        }]
      }
    })

    test('removeFirebaseMetaData strips FCM entries, keeps local + updates ones', () => {
      const m = removeFirebaseMetaData(parsedManifest())
      const names = m.manifest.application[0]['meta-data'].map(md => md.$['android:name'])
      expect(names).not.toContain(FIREBASE_META_KEYS[0])
      expect(names).not.toContain(FIREBASE_META_KEYS[1])
      expect(names).toContain('expo.modules.notifications.default_notification_color')
      expect(names).toContain('expo.modules.notifications.default_notification_icon')
      expect(names).toContain('expo.modules.updates.ENABLED')
    })

    test('removeFirebaseMetaData tolerates a manifest without application/meta-data', () => {
      expect(removeFirebaseMetaData({ manifest: {} })).toEqual({ manifest: {} })
      expect(removeFirebaseMetaData({ manifest: { application: [{ $: {} }] } })).toEqual({ manifest: { application: [{ $: {} }] } })
      expect(removeFirebaseMetaData(null)).toBe(null)
    })

    test('removeHttpsQueries drops https blocks and deletes the emptied key', () => {
      const m = removeHttpsQueries(parsedManifest())
      expect(m.manifest.queries).toBeUndefined()
    })

    test('removeHttpsQueries keeps non-https queries', () => {
      const m = removeHttpsQueries({
        manifest: {
          queries: [{
            intent: [{
              action: [{ $: { 'android:name': 'android.settings.APPLICATION_DETAILS_SETTINGS' } }]
            }]
          }]
        }
      })
      expect(m.manifest.queries).toHaveLength(1)
    })

    test('removeHttpsQueries tolerates missing shapes', () => {
      expect(removeHttpsQueries({})).toEqual({})
      expect(removeHttpsQueries({ manifest: {} })).toEqual({ manifest: {} })
      expect(removeHttpsQueries({ manifest: { queries: [] } }).manifest.queries).toBeUndefined()
    })
  })

  describe('helpers', () => {
    test('stripPermissionLines removes declarations with extra attributes', () => {
      const contents = [
        '  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion"/>',
        '  <uses-permission android:name="android.permission.INTERNET"/>',
        '  <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'
      ].join('\n')
      const out = stripPermissionLines(stripPermissionLines(contents, 'android.permission.INTERNET'), 'android.permission.READ_EXTERNAL_STORAGE')
      expect(out).not.toContain('INTERNET')
      expect(out).not.toContain('READ_EXTERNAL_STORAGE')
      expect(out).toContain('POST_NOTIFICATIONS')
    })

    test('stripMetaData removes single- and multi-line meta-data', () => {
      const single = '<meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/x"/>'
      const multi = '<meta-data android:name="com.google.firebase.messaging.default_notification_icon"\n      android:resource="@drawable/y"\n    />'
      const contents = '  ' + single + '\n  ' + multi + '\n  <meta-data android:name="keep.me" android:value="1"/>'
      const out = stripMetaData(stripMetaData(contents, FIREBASE_META_KEYS[0]), FIREBASE_META_KEYS[1])
      expect(out).not.toContain('firebase')
      expect(out).toContain('keep.me')
    })

    test('stripHttpsQueriesBlock handles the raw template (comment + spaces) and keeps other blocks', () => {
      const rawTemplateBlock = [
        '    <queries>',
        '      <!-- Support checking for http(s) links via the Linking API -->',
        '      <intent>',
        '        <action android:name="android.intent.action.VIEW" />',
        '        <category android:name="android.intent.category.BROWSABLE" />',
        '        <data android:scheme="https" />',
        '      </intent>',
        '    </queries>'
      ].join('\n')
      const settingsQueries = [
        '  <queries>',
        '    <intent>',
        '      <action android:name="android.settings.ACTION_SETTINGS"/>',
        '    </intent>',
        '  </queries>'
      ].join('\n')
      const out = stripHttpsQueriesBlock(rawTemplateBlock + '\n' + settingsQueries + '\n')
      expect(out).not.toContain('https')
      expect(out).not.toContain('BROWSABLE')
      expect(out).toContain('android.settings.ACTION_SETTINGS')
    })

    test('composeOfflinePermissionBlock emits one marker per removed permission', () => {
      const block = composeOfflinePermissionBlock()
      for (const p of PERMISSIONS_TO_REMOVE) {
        expect(block).toContain('<uses-permission android:name="' + p + '" tools:node="remove"/>')
      }
      for (const p of PERMISSIONS_TO_DECLARE) {
        expect(block).toContain('<uses-permission android:name="' + p + '"/>')
      }
    })

    test('composeFcmRemovalBlock targets the FQCN', () => {
      expect(composeFcmRemovalBlock()).toContain(
        '<service android:name="' + FCM_SERVICE_FQCN + '" tools:node="remove"/>'
      )
    })
  })

  describe('variant overlays (debug / debugOptimized)', () => {
    test('clean overlay has no dev-overlay window permission and no cleartext=true', () => {
      for (const variant of ['debug', 'debugOptimized']) {
        const overlay = composeCleanVariantOverlay(variant)
        expect(overlay).not.toContain('SYSTEM_ALERT_WINDOW')
        expect(overlay).not.toContain('usesCleartextTraffic="true"')
        expect(overlay).toContain('usesCleartextTraffic="false"')
        // complete single-root document
        expect(overlay.split('<manifest').length - 1).toBe(1)
        expect(overlay.split('</manifest>').length - 1).toBe(1)
        expect(overlay.trim().endsWith('</manifest>')).toBe(true)
        // both namespaces the merger needs
        expect(overlay).toContain('xmlns:android="http://schemas.android.com/apk/res/android"')
        expect(overlay).toContain('xmlns:tools="http://schemas.android.com/tools"')
      }
    })
  })

  describe('end-to-end invariant over both shapes', () => {
    test('after patching, no variant source declares INTERNET anywhere', () => {
      for (const fixture of [RAW_TEMPLATE_MANIFEST, SERIALIZED_TEMPLATE_MANIFEST]) {
        const patched = patchMainManifest(fixture)
        const lines = patched.split('\n').filter(l => l.includes('android.permission.INTERNET'))
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('tools:node="remove"')
      }
    })

    test('the patched manifest survives a simulated variant merge', () => {
      // The debug overlay re-declares the dev-overlay window permission at
      // HIGHER merge priority than main — that is why the overlay itself
      // must be cleaned. Simulate: overlay(clean) + main(remove markers)
      // must contain no bare permission declaration at all.
      const patched = patchMainManifest(RAW_TEMPLATE_MANIFEST)
      const overlay = composeCleanVariantOverlay('debug')
      const merged = overlay + patched
      for (const p of PERMISSIONS_TO_REMOVE) {
        const occurrences = merged.split('"' + p + '"').length - 1
        // exactly the single remove marker in main
        expect(occurrences).toBe(1)
      }
    })
  })

  describe('file operations (temp dir)', () => {
    test('clean overlay rewrite is stable and detects no-op; release overlay is deleted', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-manifest-'))
      const overlayPath = path.join(dir, 'AndroidManifest.xml')
      fs.writeFileSync(overlayPath, 'garbage with SYSTEM_ALERT_WINDOW', 'utf8')
      expect(ensureCleanVariantOverlay(overlayPath, 'debug')).toBe(true)
      const first = fs.readFileSync(overlayPath, 'utf8')
      expect(ensureCleanVariantOverlay(overlayPath, 'debug')).toBe(false)
      expect(fs.readFileSync(overlayPath, 'utf8')).toBe(first)

      const releaseDir = path.join(dir, 'release')
      fs.mkdirSync(releaseDir, { recursive: true })
      fs.writeFileSync(path.join(releaseDir, 'AndroidManifest.xml'), 'legacy', 'utf8')
      expect(removeReleaseOverlay(releaseDir)).toBe(true)
      expect(fs.existsSync(path.join(releaseDir, 'AndroidManifest.xml'))).toBe(false)
      fs.rmSync(dir, { recursive: true, force: true })
    })
  })
})
