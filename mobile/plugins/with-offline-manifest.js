/**
 * Local Expo config plugin: make EVERY build of the app structurally
 * network-free — not just release, and not just INTERNET.
 *
 * History of the requirement (user reports):
 *   2026-10-22 round 2: "the app still uses network … this app should not
 *     use any internet permissions at all, neither on android or desktop."
 *     → every variant lost INTERNET, cleartext traffic, the dev-overlay
 *       window permission, the https-browsable queries block and expo's
 *       ExpoFirebaseMessagingService.
 *   2026-10-23 round 3: "unfortunately that didnt cut it" — the installed
 *     APK still showed, in the system App Ops list:
 *       ACCESS_NETWORK_STATE, WAKE_LOCK,
 *       com.google.android.c2dm.permission.RECEIVE,
 *       com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE,
 *       READ_APP_BADGE + 15 launcher badge permissions.
 *     Root cause: round 2 only stripped TEMPLATE permissions. The ones
 *     above are contributed by LIBRARY AARs at gradle manifest-merge time,
 *     which tools:node="remove" markers in the main manifest must fight.
 *
 * COMPLETE AAR AUDIT (ground truth, verified against the actual artifacts
 * downloaded from google maven / maven central on 2026-10-23):
 *
 *   firebase-messaging 25.0.1          (via expo-notifications)
 *     → ACCESS_NETWORK_STATE, WAKE_LOCK, c2dm.permission.RECEIVE
 *     → components: FirebaseInstanceIdReceiver, FirebaseMessagingService,
 *       ComponentDiscoveryService
 *   firebase-installations 18.0.0       (transitive)
 *     → ACCESS_NETWORK_STATE, INTERNET
 *   firebase-common 22.0.1              (transitive)
 *     → components: FirebaseInitProvider (auto-initializes Firebase at app
 *       start!), ComponentDiscoveryService
 *   transport-runtime 3.1.8             (transitive, event-upload pipeline)
 *     → ACCESS_NETWORK_STATE
 *     → components: JobInfoSchedulerService,
 *       AlarmManagerSchedulerBroadcastReceiver, TransportBackendDiscovery
 *   transport-backend-cct 3.1.8         (transitive, uploads to Google)
 *     → ACCESS_NETWORK_STATE, INTERNET
 *   play-services-cloud-messaging 17.2.0 (transitive)
 *     → ACCESS_NETWORK_STATE, INTERNET, WAKE_LOCK, c2dm.permission.RECEIVE
 *   installreferrer 2.2                 (via expo-application — pure
 *     Play-Store install attribution, i.e. telemetry for marketers)
 *     → com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE
 *   me.leolin:ShortcutBadger 1.1.22     (via expo-notifications, launcher
 *     icon badges — this app never sets a badge)
 *     → 16 launcher badge permissions + android.permission.READ_APP_BADGE
 *   expo-file-system (source manifest)  → INTERNET, R/W_EXTERNAL_STORAGE
 *   expo-notifications (source)         → POST_NOTIFICATIONS,
 *     RECEIVE_BOOT_COMPLETED (both KEPT — local reminders need them)
 *   firebase-components, firebase-datatransport, firebase-encoders (all
 *     flavors), firebase-iid-interop, firebase-installations-interop,
 *     firebase-measurement-connector, transport-api,
 *     play-services-base/basement/tasks/stats, androidx.core, react-android
 *     → no permissions, no components (verified)
 *
 * Policy per the user's strict constraints (2026-10-23):
 *   - No network permission may exist in ANY variant — not INTERNET, not
 *     ACCESS_NETWORK_STATE, not the whole wifi/network-state family.
 *   - No telemetry/attribution component or permission may exist: the FCM
 *     push entry points, the Firebase auto-init provider and the
 *     datatransport upload workers are all pulled from the merge.
 *   - expo-notifications itself stays: it is what schedules the LOCAL
 *     reminders, and with zero network permissions it is verifiably
 *     offline-capable (the OS itself blocks any socket). Its bundled
 *     firebase/cloud-messaging classes become unreachable dead code with
 *     no manifest entry points — compiling them away would require gradle
 *     exclusions that risk NoClassDefFoundError in code paths we cannot
 *     runtime-test, so they are neutered at the manifest level instead.
 *
 * WAKE_LOCK is safe to remove: a source grep of expo-notifications 57.0.23
 * shows the local-notification/alarm path never acquires a wake lock; the
 * only declarers are the dead FCM/cloud-messaging AARs. Exact alarms +
 * broadcast receivers do not need an app-held wake lock.
 *
 * HOW EXPO'S MOD PIPELINE ACTUALLY RUNS (verified empirically 2026-10-22):
 *   1. prebuild --clean copies the raw template to android/
 *   2. dangerous mods (withDangerousMod) run FIRST (precedence -1), and
 *      within each mod name callbacks execute LIFO: the plugin registered
 *      LAST runs FIRST. File surgery at this stage sees the raw template
 *      bytes (including the template's comments).
 *   3. the androidManifest mod chain (withAndroidManifest) runs LAST:
 *      it parses the file (comments dropped), runs every registered
 *      callback — again LIFO, so the plugin registered EARLIEST runs
 *      LAST — then sorts and re-serializes.
 *
 * Therefore this plugin registers BOTH mod types and MUST be listed in
 * app.json BEFORE "expo-notifications" (so that, executing LIFO, our
 * manifest callback runs AFTER expo-notifications re-adds its meta-data):
 *   - withDangerousMod: string surgery on the raw template
 *     (delete direct permission declarations, insert tools:node="remove"
 *     markers for ALL blocked permissions, insert the exact-alarm
 *     declarations, add the component remove markers inside
 *     <application>, drop the https queries block; clean the debug and
 *     debugOptimized overlays; delete the obsolete release overlay).
 *     Pure XML ELEMENTS survive step 3's parse-sort-serialize round-trip;
 *     comments do not — which is why idempotency below never relies on
 *     comment markers.
 *   - withAndroidManifest: parsed-tree surgery as the LAST callback to
 *     touch the manifest (after expo-notifications added its meta-data):
 *     remove the two com.google.firebase.messaging.* meta-data entries
 *     (keep expo.modules.notifications.* — the LOCAL reminder icons) and
 *     drop the https-browsable queries block if it somehow survived.
 *
 * What deliberately SURVIVES everywhere (the app's ENTIRE permission
 * surface after this plugin — nothing else can appear):
 *   android.permission.POST_NOTIFICATIONS   (reminder visibility, API 33+)
 *   android.permission.RECEIVE_BOOT_COMPLETED (reschedule alarms after reboot)
 *   android.permission.USE_EXACT_ALARM      (fire reminders on time)
 *   android.permission.SCHEDULE_EXACT_ALARM (same, user-grantable variant)
 *   <pkg>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION — androidx-injected at
 *     BUILD time by the manifest merger itself (not present in any source
 *     manifest, so it cannot be removed). Signature-level self-marker for
 *     dynamically-registered receivers on API 34+; grants no capability,
 *     touches no network. The expo-notifications reminder receivers need
 *     it on Android 14+.
 * Components that survive: MainActivity, MainApplication, CrashLogProvider,
 * expo-notifications' local machinery (NotificationsService boot receiver,
 * NotificationForwarderActivity) and the expo.modules.notifications.*
 * meta-data. The expo.modules.updates.* meta-data stays as a defensive
 * ENABLED=false (expo-updates is NOT installed).
 *
 * There is no iOS target in this project (platforms: ["android"] only), so
 * no Info.plist exists to police; if an iOS variant is ever added the same
 * policy applies (no ATS exceptions, no background-network entitlements).
 */
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-offline-manifest]';

// ---------------------------------------------------------------------------
// Permission policy tables
// ---------------------------------------------------------------------------

// The socket/network-state family. Sources: template (INTERNET),
// firebase-messaging, firebase-installations, transport-backend-cct,
// play-services-cloud-messaging, expo-file-system. The last three are
// defensive: nothing declares them today, and markers for absent
// permissions are harmless merge-time no-ops that protect against future
// dependency changes.
const NETWORK_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_NETWORK_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.READ_PHONE_STATE'
];

// Google push (FCM) plumbing. WAKE_LOCK is declared only by the dead
// firebase-messaging / play-services-cloud-messaging AARs — the local
// reminder path never acquires one (verified by source grep).
const PUSH_PERMISSIONS = [
  'android.permission.WAKE_LOCK',
  'com.google.android.c2dm.permission.RECEIVE'
];

// Play-Store install attribution — pure marketer telemetry from
// installreferrer 2.2 (pulled in by expo-application).
const ATTRIBUTION_PERMISSIONS = [
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'
];

// Launcher icon badges, declared wholesale by me.leolin:ShortcutBadger
// (pulled in by expo-notifications). This app never sets a badge count;
// ShortcutBadger's applyCount swallows failures, so removing the
// permissions cannot break anything.
const BADGE_PERMISSIONS = [
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
];

// Unused template baggage (storage permissions are not needed: all data
// lives in app-private storage / SAF documents; SYSTEM_ALERT_WINDOW was
// the debug dev-overlay; VIBRATE is not needed — notification vibration
// goes through the NotificationChannel, which the system enforces).
const LEGACY_TEMPLATE_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
];

// Every permission removed from EVERY variant. Direct declarations are
// deleted from the main manifest and tools:node="remove" markers are added
// so library contributions cannot re-introduce them at merge time.
const PERMISSIONS_TO_REMOVE = [
  ...NETWORK_PERMISSIONS,
  ...PUSH_PERMISSIONS,
  ...ATTRIBUTION_PERMISSIONS,
  ...BADGE_PERMISSIONS,
  ...LEGACY_TEMPLATE_PERMISSIONS
];

// Exact-alarm permissions DECLARED in the main manifest for the local
// reminder system (moved here from the old release-only overlay so debug
// installs get on-time reminders too). Android 12+; harmless below.
const PERMISSIONS_TO_DECLARE = [
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM'
];

// ---------------------------------------------------------------------------
// Component policy table — manifest entry points pulled out of the merge
// ---------------------------------------------------------------------------

// expo-notifications' FCM push entry point. Fully-qualified class name as
// the manifest merger sees it after resolving the library's relative name.
const FCM_SERVICE_FQCN = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';

// Network/telemetry components removed from the merged manifest. Each is
// declared by a library AAR (see the audit table in the header) and every
// one of them is unreachable-and-useless in a network-free app:
//   - expo's ExpoFirebaseMessagingService + firebase's own
//     FirebaseMessagingService / FirebaseInstanceIdReceiver: push delivery,
//     dead without INTERNET and c2dm.
//   - FirebaseInitProvider: the content provider that auto-runs
//     FirebaseApp.initializeApp() at app start. Nothing in this app (or in
//     expo-notifications' local-notification path) requires an initialized
//     FirebaseApp — the JS side never calls a push/token/topic API.
//   - ComponentDiscoveryService: bound only during Firebase component
//     discovery, which never happens once the init provider is gone.
//   - JobInfoSchedulerService / AlarmManagerSchedulerBroadcastReceiver /
//     TransportBackendDiscovery: the datatransport event-upload pipeline
//     (Google's telemetry transport). Inert without Firebase, removed for
//     the same "no network-named component" reason as round 2's FCM service.
// The provider needs its authorities attribute for the merge key to match
// (placeholders compare literally — the AAR uses the same ${applicationId}
// token at merge time).
const COMPONENTS_TO_REMOVE = [
  { tag: 'service', name: FCM_SERVICE_FQCN },
  { tag: 'service', name: 'com.google.firebase.messaging.FirebaseMessagingService' },
  { tag: 'receiver', name: 'com.google.firebase.iid.FirebaseInstanceIdReceiver' },
  { tag: 'service', name: 'com.google.firebase.components.ComponentDiscoveryService' },
  {
    tag: 'provider',
    name: 'com.google.firebase.provider.FirebaseInitProvider',
    authorities: '${applicationId}.firebaseinitprovider'
  },
  { tag: 'service', name: 'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService' },
  { tag: 'receiver', name: 'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver' },
  { tag: 'service', name: 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery' }
];

// Firebase meta-data keys written into the main manifest by the
// expo-notifications config plugin. Pure push-notification configuration;
// local reminders never read them.
const FIREBASE_META_KEYS = [
  'com.google.firebase.messaging.default_notification_color',
  'com.google.firebase.messaging.default_notification_icon'
];

// The one permission marker whose presence proves the block was inserted.
// NEVER a comment — the androidManifest chain drops comments on
// re-serialization, so comments cannot provide idempotency.
const INTERNET_REMOVE_MARKER = '<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>';

// The one component marker whose presence proves the component block was
// inserted (the expo FCM service is always the first entry).
const COMPONENT_BLOCK_GUARD = '<service android:name="' + FCM_SERVICE_FQCN + '" tools:node="remove"/>';

// ---------------------------------------------------------------------------
// String surgery helpers (dangerous-mod stage: raw template text)
// ---------------------------------------------------------------------------

/**
 * Delete every <uses-permission …> LINE for a given permission name,
 * whatever extra attributes it carries (tools:replace, maxSdkVersion…)
 * and whatever indentation surrounds it. Line-based on purpose: a plain
 * regex would also match the tools:node="remove" MARKERS this plugin
 * itself inserts, which would break idempotency (pass 2 would delete
 * pass 1's markers and re-insert the whole block). Lines carrying
 * tools:node= are always kept.
 */
function stripPermissionLines(contents, permission) {
  const escaped = permission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = new RegExp('<uses-permission[^>]*android:name="' + escaped + '"');
  const kept = contents.split('\n').filter(line => {
    if (!line.includes('<uses-permission')) return true;
    if (!nameRe.test(line)) return true;
    if (line.includes('tools:node=')) return true; // keep our own remove markers
    return false; // direct declaration — drop the whole line
  });
  return kept.join('\n');
}

/**
 * Remove a meta-data element whose android:name matches, covering
 * single-line, multi-line and pretty-printed serializations. The `[^>]*`
 * character class spans newlines, so attribute-per-line layouts match too.
 */
function stripMetaData(contents, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const oneLine = new RegExp('[ \\t]*<meta-data[^>]*android:name="' + escaped + '"[^>]*/>[ \\t]*\\r?\\n?', 'g');
  const paired = new RegExp(
    '[ \\t]*<meta-data[^>]*android:name="' + escaped + '"[^>]*>[ \\t]*\\r?\\n' +
    '(?:[^<]*\\n)*?' +
    '[ \\t]*</meta-data>[ \\t]*\\r?\\n?',
    'g'
  );
  return contents.replace(paired, '').replace(oneLine, '');
}

/**
 * Remove every <queries>…</queries> block that asks for visibility of
 * https browsers. The RAW template block contains a comment line and
 * space-padded self-closing tags, so this must be tolerant: match whole
 * blocks non-greedily, then keep only the ones that are NOT about https.
 * Package-visibility queries from libraries (e.g. settings intents) are
 * untouched — visibility is not network.
 */
function stripHttpsQueriesBlock(contents) {
  return contents.replace(/[ \t]*<queries>[\s\S]*?<\/queries>[ \t]*(?:\r?\n)?/g, block =>
    block.includes('android:scheme="https"') ? '' : block
  );
}

/**
 * Compose the complete offline permission block: one tools:node="remove"
 * marker for every blocked permission plus the exact-alarm declarations.
 * Pure ELEMENTS only, one per line — no comments, because (a) the
 * androidManifest chain drops comments on re-serialization anyway and
 * (b) granular insertion (see patchMainManifest) must be able to check
 * and re-insert each line independently of any decoration. Pure function.
 */
function composeOfflinePermissionBlock() {
  const lines = [];
  for (const p of PERMISSIONS_TO_REMOVE) {
    lines.push('  <uses-permission android:name="' + p + '" tools:node="remove"/>');
  }
  for (const p of PERMISSIONS_TO_DECLARE) {
    lines.push('  <uses-permission android:name="' + p + '"/>');
  }
  return lines.join('\n') + '\n';
}

/**
 * Compose the component-removal block that goes INSIDE <application>:
 * tools:node="remove" markers pulling every network/telemetry entry point
 * out of the merged manifest (see COMPONENTS_TO_REMOVE for the rationale).
 * Pure single-line ELEMENTS only — same reasoning as the permission block.
 * Pure function.
 */
function composeComponentRemovalBlock() {
  const lines = [];
  for (const c of COMPONENTS_TO_REMOVE) {
    let attrs = 'android:name="' + c.name + '"';
    if (c.authorities) {
      attrs += ' android:authorities="' + c.authorities + '"';
    }
    attrs += ' tools:node="remove"';
    lines.push('    <' + c.tag + ' ' + attrs + '/>');
  }
  return lines.join('\n') + '\n';
}

/**
 * Apply ALL main-manifest transformations (dangerous-mod stage: raw template
 * text, or a previously-serialized manifest when prebuild runs without
 * --clean over an existing android/ folder). Pure string function — unit-
 * tested against the real template layout. Throws (loud, early) when the
 * template layout changed upstream, rather than silently shipping network
 * permissions.
 *
 * Insertion is GRANULAR, per element: every missing marker is added on its
 * own, so a manifest produced by an OLDER version of this plugin (round 2
 * shipped only the INTERNET-family markers and the expo FCM service) is
 * upgraded in place instead of being skipped whole — a whole-block guard
 * would have silently left round-3's 24 new permission markers and 7 new
 * component markers out of any non-clean prebuild. Each element is guarded
 * on its own text, never on a comment, because the androidManifest chain
 * strips comments on re-serialization.
 */
function patchMainManifest(contents) {
  let out = contents;

  // 1. delete every direct permission declaration (no-op if absent)
  for (const p of PERMISSIONS_TO_REMOVE) {
    out = stripPermissionLines(out, p);
  }

  // 2. insert every MISSING permission marker / exact-alarm declaration
  //    right after the opening <manifest …> tag
  const missingPermissions = composeOfflinePermissionBlock()
    .split('\n')
    .filter(line => line.trim() && !out.includes(line.trim()));
  if (missingPermissions.length > 0) {
    const manifestOpen = out.match(/<manifest[^>]*>/);
    if (!manifestOpen) {
      throw new Error(TAG + ' <manifest> opening tag not found — template layout changed upstream; offline guarantees NOT applied');
    }
    out = out.replace(manifestOpen[0], manifestOpen[0] + '\n' + missingPermissions.join('\n'));
  }

  // 3. drop the https-browsable queries block (no-op if absent)
  out = stripHttpsQueriesBlock(out);

  // 4. drop the firebase push meta-data (no-op if absent — the
  //    withAndroidManifest stage below removes them even when they are
  //    re-added later in the pipeline)
  for (const key of FIREBASE_META_KEYS) {
    out = stripMetaData(out, key);
  }

  // 5. insert every MISSING component remove marker right after the
  //    opening <application …> tag. Presence is guarded on the component's
  //    class name — at prebuild time these FQCNs exist nowhere else, so a
  //    name found in the file can only be our own marker (attribute order
  //    may differ after a serialization round-trip, so never guard on the
  //    full element text here).
  const missingComponents = COMPONENTS_TO_REMOVE.filter(c => !out.includes(c.name));
  if (missingComponents.length > 0) {
    if (!out.includes('<application')) {
      throw new Error(TAG + ' <application> not found — template layout changed upstream; offline guarantees NOT applied');
    }
    const componentLines = missingComponents.map(c => {
      let attrs = 'android:name="' + c.name + '"';
      if (c.authorities) {
        attrs += ' android:authorities="' + c.authorities + '"';
      }
      return '    <' + c.tag + ' ' + attrs + ' tools:node="remove"/>';
    });
    out = out.replace(/<application[^>]*>/, m => m + '\n' + componentLines.join('\n'));
  }

  // 6. the tools namespace must be declared for the remove markers to work
  if (!/<manifest[^>]*xmlns:tools=/.test(out)) {
    out = out.replace(/<manifest([^>]*)>/, (m, attrs) =>
      '<manifest' + attrs + ' xmlns:tools="http://schemas.android.com/tools">');
  }

  // 7. normalize blank-line runs created by the removals above so that a
  //    second pass over the SAME text is a byte-identical no-op (the runs
  //    left by queries/meta-data removal are collapsed here, in the same
  //    pass that created them)
  out = out.replace(/\n{3,}/g, '\n\n');

  return out;
}

// ---------------------------------------------------------------------------
// Parsed-tree surgery (withAndroidManifest stage: runs last in the chain)
// ---------------------------------------------------------------------------

/**
 * Remove the firebase push meta-data from a PARSED manifest (xml2js object
 * tree, the shape withAndroidManifest callbacks receive). Runs as the LAST
 * callback in the androidManifest chain — after expo-notifications has
 * (re-)added the entries — so the removal always sticks. Keeps the
 * expo.modules.notifications.* entries: those configure the LOCAL reminder
 * icon and color. Pure function.
 */
function removeFirebaseMetaData(manifest) {
  const root = manifest && manifest.manifest;
  const applications = root && root.application;
  if (!Array.isArray(applications)) return manifest;
  for (const application of applications) {
    if (Array.isArray(application['meta-data'])) {
      application['meta-data'] = application['meta-data'].filter(md => {
        const name = md && md.$ && md.$['android:name'];
        return !FIREBASE_META_KEYS.includes(name);
      });
    }
  }
  return manifest;
}

/**
 * Drop the https-browsable queries block from a PARSED manifest — the
 * belt-and-braces twin of stripHttpsQueriesBlock for the modResults tree.
 * Only removes queries entries that ask for https scheme visibility.
 * Pure function.
 */
function removeHttpsQueries(manifest) {
  const root = manifest && manifest.manifest;
  if (!root || !Array.isArray(root.queries)) return manifest;
  const kept = root.queries.filter(q => {
    const intents = Array.isArray(q && q.intent) ? q.intent : [];
    const hasHttps = intents.some(intent => {
      const data = Array.isArray(intent && intent.data) ? intent.data : [];
      return data.some(d => d && d.$ && d.$['android:scheme'] === 'https');
    });
    return !hasHttps;
  });
  if (kept.length === 0) {
    delete root.queries;
  } else {
    root.queries = kept;
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Variant overlay handling
// ---------------------------------------------------------------------------

/**
 * Compose a minimal, network-free variant overlay that replaces whatever
 * the debug/debugOptimized templates wrote (SYSTEM_ALERT_WINDOW +
 * usesCleartextTraffic). Pure function.
 */
function composeCleanVariantOverlay(variant) {
  return [
    '<!-- ' + TAG + ' (mobile/plugins/with-offline-manifest.js) -->',
    '<!-- Variant overlay cleaned: the debug template re-adds the dev-overlay',
    '     window permission and the cleartext-traffic flag here at a merge',
    '     priority ABOVE the main manifest, so they must be removed at the',
    '     source — a tools:node="remove" in main cannot beat this overlay.',
    '     This app is fully offline in EVERY variant: no network permission,',
    '     no cleartext traffic, no dev-server tooling (debug builds are',
    '     standalone — see plugins/with-standalone-release.js). -->',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '    xmlns:tools="http://schemas.android.com/tools">',
    '',
    '    <application tools:replace="android:usesCleartextTraffic" android:usesCleartextTraffic="false" />',
    '</manifest>'
  ].join('\n') + '\n';
}

/**
 * Rewrite a variant overlay file (debug / debugOptimized) with the clean
 * version. Returns true when the file was rewritten, false when it was
 * already clean.
 */
function ensureCleanVariantOverlay(overlayPath, variant) {
  const desired = composeCleanVariantOverlay(variant);
  if (fs.existsSync(overlayPath)) {
    const current = fs.readFileSync(overlayPath, 'utf8');
    if (current === desired) return false;
  }
  fs.writeFileSync(overlayPath, desired, 'utf8');
  return true;
}

/**
 * Delete the release overlay written by the previous with-release-permissions
 * plugin. Everything it did now lives in the main manifest.
 */
function removeReleaseOverlay(releaseDir) {
  const manifestPath = path.join(releaseDir, 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) return false;
  fs.unlinkSync(manifestPath);
  // drop the now-empty directory when possible (never an error)
  try { fs.rmdirSync(releaseDir); } catch (e) { /* not empty — fine */ }
  return true;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

const withOfflineManifest = config => {
  // Stage 3 (LAST in the androidManifest chain — this plugin is registered
  // after expo-notifications in app.json): parsed-tree surgery.
  config = withAndroidManifest(config, configInner => {
    configInner.modResults = removeFirebaseMetaData(configInner.modResults);
    configInner.modResults = removeHttpsQueries(configInner.modResults);
    return configInner;
  });

  // Stage 2 (dangerous mods, reverse registration order): raw-template
  // string surgery + variant overlay cleanup.
  return withDangerousMod(config, [
    'android',
    async config => {
      const androidRoot = path.join(config.modRequest.projectRoot, 'android');
      if (!fs.existsSync(androidRoot)) {
        console.warn(TAG + ': android/ project not found — skipping (unexpected).');
        return config;
      }

      // 1. main manifest
      const mainManifest = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
      if (!fs.existsSync(mainManifest)) {
        console.warn(TAG + ': main AndroidManifest.xml not found — skipping (unexpected).');
        return config;
      }
      fs.writeFileSync(mainManifest, patchMainManifest(fs.readFileSync(mainManifest, 'utf8')), 'utf8');
      console.log(
        TAG + ': main manifest hardened — ' +
          PERMISSIONS_TO_REMOVE.length + ' permissions blocked in EVERY variant' +
          ' (INTERNET + ACCESS_NETWORK_STATE + FCM + install-referrer + badges included),' +
          ' ' + COMPONENTS_TO_REMOVE.length + ' network components pulled from the merge' +
          ' (FCM services, Firebase auto-init provider, datatransport workers),' +
          ' https-queries block dropped, exact-alarm pair declared.'
      );

      // 2. debug + debugOptimized overlays
      for (const variant of ['debug', 'debugOptimized']) {
        const variantDir = path.join(androidRoot, 'app', 'src', variant);
        const overlayPath = path.join(variantDir, 'AndroidManifest.xml');
        if (!fs.existsSync(overlayPath)) continue;
        const rewritten = ensureCleanVariantOverlay(overlayPath, variant);
        console.log(TAG + ': ' + variant + ' overlay ' + (rewritten ? 'cleaned (no dev-overlay window permission, no cleartext traffic)' : 'already clean'));
      }

      // 3. release overlay (legacy of with-release-permissions) is obsolete
      const releaseDir = path.join(androidRoot, 'app', 'src', 'release');
      const removed = removeReleaseOverlay(releaseDir);
      if (removed) {
        console.log(TAG + ': release overlay deleted — offline guarantees now live in the MAIN manifest (all variants)');
      }

      return config;
    }
  ]);
};

module.exports = withOfflineManifest;
module.exports.withOfflineManifest = withOfflineManifest;
module.exports.patchMainManifest = patchMainManifest;
module.exports.stripPermissionLines = stripPermissionLines;
module.exports.stripMetaData = stripMetaData;
module.exports.stripHttpsQueriesBlock = stripHttpsQueriesBlock;
module.exports.composeOfflinePermissionBlock = composeOfflinePermissionBlock;
module.exports.composeComponentRemovalBlock = composeComponentRemovalBlock;
module.exports.composeFcmRemovalBlock = composeComponentRemovalBlock; // legacy alias (round 2 name)
module.exports.removeFirebaseMetaData = removeFirebaseMetaData;
module.exports.removeHttpsQueries = removeHttpsQueries;
module.exports.composeCleanVariantOverlay = composeCleanVariantOverlay;
module.exports.ensureCleanVariantOverlay = ensureCleanVariantOverlay;
module.exports.removeReleaseOverlay = removeReleaseOverlay;
module.exports.PERMISSIONS_TO_REMOVE = PERMISSIONS_TO_REMOVE;
module.exports.PERMISSIONS_TO_DECLARE = PERMISSIONS_TO_DECLARE;
module.exports.NETWORK_PERMISSIONS = NETWORK_PERMISSIONS;
module.exports.PUSH_PERMISSIONS = PUSH_PERMISSIONS;
module.exports.ATTRIBUTION_PERMISSIONS = ATTRIBUTION_PERMISSIONS;
module.exports.BADGE_PERMISSIONS = BADGE_PERMISSIONS;
module.exports.LEGACY_TEMPLATE_PERMISSIONS = LEGACY_TEMPLATE_PERMISSIONS;
module.exports.COMPONENTS_TO_REMOVE = COMPONENTS_TO_REMOVE;
module.exports.FCM_SERVICE_FQCN = FCM_SERVICE_FQCN;
module.exports.FIREBASE_META_KEYS = FIREBASE_META_KEYS;
module.exports.INTERNET_REMOVE_MARKER = INTERNET_REMOVE_MARKER;
module.exports.COMPONENT_BLOCK_GUARD = COMPONENT_BLOCK_GUARD;
module.exports.TAG = TAG;
