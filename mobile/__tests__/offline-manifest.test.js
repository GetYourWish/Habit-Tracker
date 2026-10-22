// Unit tests for mobile/plugins/with-offline-manifest.js
//
// Round 2 (2026-10-22): "the app still uses network … this app should not
// use any internet permissions at all." → every variant lost INTERNET,
// cleartext traffic, the dev-overlay window permission, the https queries
// block and expo's FCM service.
//
// Round 3 (2026-10-23): "unfortunately that didnt cut it" — the installed
// APK still showed ACCESS_NETWORK_STATE, WAKE_LOCK, c2dm.RECEIVE, the
// Play install-referrer permission and 17 badge permissions. Root cause:
// round 2 only stripped TEMPLATE permissions, but these arrive from LIBRARY
// AARs at gradle manifest-merge time. The plugin now blocks every one of
// them with tools:node="remove" markers and additionally pulls the FCM /
// Firebase-init / datatransport components out of the merge.
//
// Stages under test (matching expo's mod pipeline):
//   stage A (dangerous mod, raw template):  patchMainManifest string surgery
//   stage B (withAndroidManifest, LAST):    parsed-tree surgery that undoes
//     what expo-notifications re-adds after stage A (FCM meta-data)
//
// The AAR-coverage describe block pins the plugin against the REAL
// manifests of every network-capable artifact in the dependency graph
// (downloaded and inspected 2026-10-23) — if a dependency upgrade brings
// a new permission or component in, this test fails until the blocklist
// is extended.

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  patchMainManifest,
  stripPermissionLines,
  stripMetaData,
  stripHttpsQueriesBlock,
  composeOfflinePermissionBlock,
  composeComponentRemovalBlock,
  removeFirebaseMetaData,
  removeHttpsQueries,
  composeCleanVariantOverlay,
  ensureCleanVariantOverlay,
  removeReleaseOverlay,
  PERMISSIONS_TO_REMOVE,
  PERMISSIONS_TO_DECLARE,
  NETWORK_PERMISSIONS,
  PUSH_PERMISSIONS,
  ATTRIBUTION_PERMISSIONS,
  BADGE_PERMISSIONS,
  LEGACY_TEMPLATE_PERMISSIONS,
  COMPONENTS_TO_REMOVE,
  FCM_SERVICE_FQCN,
  FIREBASE_META_KEYS,
  INTERNET_REMOVE_MARKER,
  COMPONENT_BLOCK_GUARD,
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

// ---------------------------------------------------------------------------
// GROUND TRUTH: the permissions + components every network-capable AAR in
// the dependency graph declares, transcribed from the actual artifacts
// (google maven / maven central, 2026-10-23). The expo-notifications
// entry is its SOURCE manifest (node_modules). This is the table that
// would have caught round 3's leak — do not trim it to make a test pass;
// extend the plugin's blocklists instead.
// ---------------------------------------------------------------------------
const AAR_GROUND_TRUTH = [
  {
    artifact: 'com.google.firebase:firebase-messaging:25.0.1 (via expo-notifications)',
    permissions: [
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS', // kept deliberately
      'android.permission.WAKE_LOCK',
      'com.google.android.c2dm.permission.RECEIVE'
    ],
    components: [
      { tag: 'receiver', name: 'com.google.firebase.iid.FirebaseInstanceIdReceiver' },
      { tag: 'service', name: 'com.google.firebase.messaging.FirebaseMessagingService' },
      { tag: 'service', name: 'com.google.firebase.components.ComponentDiscoveryService' }
    ]
  },
  {
    artifact: 'com.google.firebase:firebase-installations:18.0.0 (transitive)',
    permissions: ['android.permission.ACCESS_NETWORK_STATE', 'android.permission.INTERNET'],
    components: [
      { tag: 'service', name: 'com.google.firebase.components.ComponentDiscoveryService' }
    ]
  },
  {
    artifact: 'com.google.firebase:firebase-common:22.0.1 (transitive)',
    permissions: [],
    components: [
      { tag: 'provider', name: 'com.google.firebase.provider.FirebaseInitProvider' },
      { tag: 'service', name: 'com.google.firebase.components.ComponentDiscoveryService' }
    ]
  },
  {
    artifact: 'com.google.android.datatransport:transport-runtime:3.1.8 (transitive)',
    permissions: ['android.permission.ACCESS_NETWORK_STATE'],
    components: [
      { tag: 'service', name: 'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService' },
      { tag: 'receiver', name: 'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver' },
      { tag: 'service', name: 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery' }
    ]
  },
  {
    artifact: 'com.google.android.datatransport:transport-backend-cct:3.1.8 (transitive)',
    permissions: ['android.permission.ACCESS_NETWORK_STATE', 'android.permission.INTERNET'],
    components: [
      { tag: 'service', name: 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery' }
    ]
  },
  {
    artifact: 'com.google.android.gms:play-services-cloud-messaging:17.2.0 (transitive)',
    permissions: [
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'android.permission.WAKE_LOCK',
      'com.google.android.c2dm.permission.RECEIVE'
    ],
    components: []
  },
  {
    artifact: 'com.android.installreferrer:installreferrer:2.2 (via expo-application)',
    permissions: ['com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'],
    components: []
  },
  {
    artifact: 'me.leolin:ShortcutBadger:1.1.22 (via expo-notifications)',
    permissions: [
      'android.permission.READ_APP_BADGE',
      'com.anddoes.launcher.permission.UPDATE_COUNT',
      'com.huawei.android.launcher.permission.CHANGE_BADGE',
      'com.huawei.android.launcher.permission.READ_SETTINGS',
      'com.huawei.android.launcher.permission.WRITE_SETTINGS',
      'com.htc.launcher.permission.READ_SETTINGS',
      'com.htc.launcher.permission.UPDATE_SHORTCUT',
      'com.majeur.launcher.permission.UPDATE_BADGE',
      'com.oppo.launcher.permission.READ_SETTINGS',
      'com.oppo.launcher.permission.WRITE_SETTINGS',
      'com.sec.android.provider.badge.permission.READ',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.sonyericsson.home.permission.BROADCAST_BADGE',
      'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
      'me.everything.badger.permission.BADGE_COUNT_READ',
      'me.everything.badger.permission.BADGE_COUNT_WRITE'
    ],
    components: []
  },
  {
    artifact: 'expo-file-system (source manifest)',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE'
    ],
    components: []
  },
  {
    artifact: 'expo-notifications (source manifest)',
    permissions: [
      'android.permission.POST_NOTIFICATIONS', // kept deliberately
      'android.permission.RECEIVE_BOOT_COMPLETED' // kept deliberately
    ],
    components: [
      // kept deliberately: local reminder machinery
      { tag: 'service', name: 'expo.modules.notifications.service.ExpoFirebaseMessagingService', kept: true },
      { tag: 'receiver', name: 'expo.modules.notifications.service.NotificationsService', kept: true },
      { tag: 'activity', name: 'expo.modules.notifications.service.NotificationForwarderActivity', kept: true }
    ]
  }
]

// The entire permission surface the APK is allowed to declare.
const ALLOWED_PERMISSIONS = new Set([
  ...PERMISSIONS_TO_DECLARE,
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // androidx-injected by the manifest merger itself at build time (not
  // present in any source manifest): signature-level self-marker, no
  // capability, required by dynamically-registered receivers on API 34+.
  'com.getyourwish.habittracker.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
])

// Every component the merged manifest is allowed to keep (the app's own +
// expo-notifications' local machinery).
const ALLOWED_COMPONENT_NAMES = new Set([
  '.MainActivity',
  '.MainApplication',
  '.CrashLogProvider',
  'expo.modules.notifications.service.NotificationsService',
  'expo.modules.notifications.service.NotificationForwarderActivity'
])

describe('with-offline-manifest plugin', () => {
  describe('static policy tables', () => {
    test('blocks the entire network-state family, INTERNET first', () => {
      expect(NETWORK_PERMISSIONS).toEqual([
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.CHANGE_NETWORK_STATE',
        'android.permission.CHANGE_WIFI_STATE',
        'android.permission.READ_PHONE_STATE'
      ])
    })

    test('blocks FCM push plumbing and Play install attribution', () => {
      expect(PUSH_PERMISSIONS).toEqual([
        'android.permission.WAKE_LOCK',
        'com.google.android.c2dm.permission.RECEIVE'
      ])
      expect(ATTRIBUTION_PERMISSIONS).toEqual([
        'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'
      ])
    })

    test('blocks every ShortcutBadger launcher badge permission (16 + READ_APP_BADGE)', () => {
      expect(BADGE_PERMISSIONS).toHaveLength(16)
      expect(BADGE_PERMISSIONS).toContain('android.permission.READ_APP_BADGE')
      expect(BADGE_PERMISSIONS).toContain('me.everything.badger.permission.BADGE_COUNT_READ')
      expect(BADGE_PERMISSIONS).toContain('me.everything.badger.permission.BADGE_COUNT_WRITE')
      expect(BADGE_PERMISSIONS).toContain('com.sec.android.provider.badge.permission.READ')
      expect(BADGE_PERMISSIONS).toContain('com.sec.android.provider.badge.permission.WRITE')
      expect(new Set(BADGE_PERMISSIONS).size).toBe(16) // no duplicates
    })

    test('flattens the groups with no duplicates and no allowlist collisions', () => {
      expect(PERMISSIONS_TO_REMOVE).toHaveLength(
        NETWORK_PERMISSIONS.length +
          PUSH_PERMISSIONS.length +
          ATTRIBUTION_PERMISSIONS.length +
          BADGE_PERMISSIONS.length +
          LEGACY_TEMPLATE_PERMISSIONS.length
      )
      expect(new Set(PERMISSIONS_TO_REMOVE).size).toBe(PERMISSIONS_TO_REMOVE.length)
      for (const allowed of ALLOWED_PERMISSIONS) {
        expect(PERMISSIONS_TO_REMOVE).not.toContain(allowed)
      }
    })

    test('declares the exact-alarm pair for the local reminder system', () => {
      expect(PERMISSIONS_TO_DECLARE).toEqual([
        'android.permission.USE_EXACT_ALARM',
        'android.permission.SCHEDULE_EXACT_ALARM'
      ])
    })

    test('removes every network/telemetry component, expo FCM service first', () => {
      expect(COMPONENTS_TO_REMOVE).toHaveLength(8)
      expect(COMPONENTS_TO_REMOVE[0]).toEqual({ tag: 'service', name: FCM_SERVICE_FQCN })
      const names = COMPONENTS_TO_REMOVE.map(c => c.name)
      expect(names).toContain('com.google.firebase.provider.FirebaseInitProvider')
      expect(names).toContain('com.google.firebase.messaging.FirebaseMessagingService')
      expect(names).toContain('com.google.firebase.iid.FirebaseInstanceIdReceiver')
      expect(names).toContain('com.google.firebase.components.ComponentDiscoveryService')
      expect(names).toContain('com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService')
      expect(names).toContain('com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver')
      expect(names).toContain('com.google.android.datatransport.runtime.backends.TransportBackendDiscovery')
      // nothing we keep is accidentally on the removal list
      for (const c of COMPONENTS_TO_REMOVE) {
        expect(ALLOWED_COMPONENT_NAMES.has(c.name)).toBe(false)
      }
    })

    test('the FirebaseInitProvider marker carries the authorities merge key', () => {
      const provider = COMPONENTS_TO_REMOVE.find(c => c.name === 'com.google.firebase.provider.FirebaseInitProvider')
      expect(provider.authorities).toBe('${applicationId}.firebaseinitprovider')
    })

    test('targets the expo-notifications FCM service by its merged name', () => {
      expect(FCM_SERVICE_FQCN).toBe('expo.modules.notifications.service.ExpoFirebaseMessagingService')
    })
  })

  describe('AAR ground-truth coverage (the round-3 regression test)', () => {
    // For every permission every real AAR in the graph declares (minus the
    // deliberate allowlist), the plugin must emit a remove marker. If this
    // fails after a dependency upgrade, a NEW network permission entered
    // the graph: extend the plugin's blocklists, not this fixture.
    test('every AAR-declared permission outside the allowlist is blocked', () => {
      const blocked = new Set(PERMISSIONS_TO_REMOVE)
      for (const aar of AAR_GROUND_TRUTH) {
        for (const permission of aar.permissions) {
          if (ALLOWED_PERMISSIONS.has(permission)) continue
          expect({ aar: aar.artifact, permission, blocked: blocked.has(permission) })
            .toEqual({ aar: aar.artifact, permission, blocked: true })
        }
      }
    })

    // Same for components: every network/telemetry entry point an AAR
    // declares must have a remove marker (except expo-notifications' local
    // machinery, which stays).
    test('every AAR-declared network component is pulled from the merge', () => {
      const removedNames = new Set(COMPONENTS_TO_REMOVE.map(c => c.name))
      for (const aar of AAR_GROUND_TRUTH) {
        for (const component of aar.components) {
          if (component.kept) continue
          expect({ aar: aar.artifact, component: component.name, removed: removedNames.has(component.name) })
            .toEqual({ aar: aar.artifact, component: component.name, removed: true })
        }
      }
    })

    // The user-facing invariant: the APK's ENTIRE permission surface is the
    // allowlist. Simulate the merge of all AAR manifests with the plugin's
    // main manifest: union(AAR permissions) minus blocked must contain
    // nothing but the two library permissions local reminders need (the
    // exact-alarm pair is declared by the app's OWN main manifest via
    // PERMISSIONS_TO_DECLARE, not contributed by any AAR).
    test('union of the graph minus blocked permissions leaves only the allowlist', () => {
      const blocked = new Set(PERMISSIONS_TO_REMOVE)
      const declared = new Set()
      for (const aar of AAR_GROUND_TRUTH) {
        for (const permission of aar.permissions) {
          if (!blocked.has(permission)) declared.add(permission)
        }
      }
      expect([...declared].sort()).toEqual([
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.RECEIVE_BOOT_COMPLETED'
      ])
    })
  })

  describe('stage A — patchMainManifest on the RAW template', () => {
    let patched
    beforeAll(() => {
      patched = patchMainManifest(RAW_TEMPLATE_MANIFEST)
    })

    test('deletes all five direct template permission declarations', () => {
      const templateDeclared = [
        'android.permission.INTERNET',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE'
      ]
      for (const p of templateDeclared) {
        const occurrences = patched.split('"' + p + '"').length - 1
        expect(occurrences).toBe(1) // the remove marker only
      }
    })

    test('emits exactly one remove marker per blocked permission (29)', () => {
      for (const p of PERMISSIONS_TO_REMOVE) {
        expect(patched).toContain('<uses-permission android:name="' + p + '" tools:node="remove"/>')
        const occurrences = patched.split('"' + p + '"').length - 1
        expect(occurrences).toBe(1)
      }
    })

    test('INTERNET cannot come back: remove marker beats library manifests', () => {
      expect(patched).toContain(INTERNET_REMOVE_MARKER)
    })

    test('ACCESS_NETWORK_STATE cannot come back: the round-3 leak is closed', () => {
      expect(patched).toContain(
        '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove"/>'
      )
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

    test('pulls every network component out of the merge from inside <application>', () => {
      const applicationOpen = patched.indexOf('<application')
      const applicationClose = patched.indexOf('</application>')
      expect(applicationOpen).toBeGreaterThanOrEqual(0)
      for (const c of COMPONENTS_TO_REMOVE) {
        const marker = patched.indexOf('"' + c.name + '"')
        expect({ component: c.name, found: marker >= 0 }).toEqual({ component: c.name, found: true })
        expect(marker).toBeGreaterThan(applicationOpen)
        expect(marker).toBeLessThan(applicationClose)
        expect(patched).toContain('tools:node="remove"')
      }
      // the FirebaseInitProvider merge key rides along
      expect(patched).toContain('android:authorities="${applicationId}.firebaseinitprovider"')
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
      expect(once.split('com.google.firebase.provider.FirebaseInitProvider').length - 1).toBe(1)
      // stage A strips the firebase push meta-data too (belt and braces
      // with stage B) — note the firebase CLASS NAMES legitimately remain
      // as our component remove markers; the meta-data ENTRIES must not.
      expect(once).not.toContain(FIREBASE_META_KEYS[0])
      expect(once).not.toContain(FIREBASE_META_KEYS[1])
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

    test('stripPermissionLines does not murder its own remove markers', () => {
      const marker = '  <uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>'
      const out = stripPermissionLines(marker, 'android.permission.INTERNET')
      expect(out).toContain('tools:node="remove"')
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

    test('composeComponentRemovalBlock emits one marker per component with the right tag', () => {
      const block = composeComponentRemovalBlock()
      for (const c of COMPONENTS_TO_REMOVE) {
        const open = '<' + c.tag + ' android:name="' + c.name + '"'
        expect(block).toContain(open)
        const element = block.slice(block.indexOf(open))
        expect(element.slice(0, element.indexOf('/>') + 2)).toContain('tools:node="remove"')
      }
      expect(block).toContain('android:authorities="${applicationId}.firebaseinitprovider"')
      expect(COMPONENT_BLOCK_GUARD.length).toBeGreaterThan(0)
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
    test('after patching, no variant source declares any blocked permission', () => {
      for (const fixture of [RAW_TEMPLATE_MANIFEST, SERIALIZED_TEMPLATE_MANIFEST]) {
        const patched = patchMainManifest(fixture)
        for (const p of PERMISSIONS_TO_REMOVE) {
          const lines = patched.split('\n').filter(l => l.includes('"' + p + '"'))
          expect(lines).toHaveLength(1)
          expect(lines[0]).toContain('tools:node="remove"')
        }
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
