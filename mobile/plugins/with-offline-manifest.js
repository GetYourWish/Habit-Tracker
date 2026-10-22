/**
 * Local Expo config plugin: make EVERY build of the app structurally
 * network-free — not just release.
 *
 * Why (user report 2026-10-22, round 2): "the app still uses network …
 * they are offline apps … this app should not use any internet
 * permissions at all, neither on android or desktop." The 2026-10-22
 * round stripped INTERNET etc. from RELEASE builds only, on the
 * assumption that "dev builds are never shipped". That assumption was
 * wrong: the user installs DEBUG APKs too (see plugins/with-standalone-
 * release.js — debug builds are fully standalone since debuggableVariants
 * was emptied), and the debug variant kept:
 *
 *   android.permission.INTERNET          (main manifest, never stripped)
 *   android:usesCleartextTraffic="true" (debug manifest overlay)
 *   android.permission.SYSTEM_ALERT_WINDOW (debug manifest overlay)
 *   <queries> https browsable intent     (template, all variants)
 *   ExpoFirebaseMessagingService         (expo-notifications library
 *                                         manifest — inert without
 *                                         Firebase config, but its mere
 *                                         presence makes the app look
 *                                         network-capable)
 *   com.google.firebase.messaging.* meta-data (same)
 *
 * Since NOTHING in this app ever opens a socket — habit.json is synced by
 * SEPARATE software (Syncthing) that watches the data folder — the correct
 * policy is: no network permission, no network flag, no network-named
 * component in ANY variant (main, debug, debugOptimized, release).
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
 *     (delete the five permission declarations, insert tools:node="remove"
 *     markers, insert the exact-alarm declarations, add the FCM service
 *     remove marker, drop the https queries block; clean the debug and
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
 * What deliberately SURVIVES everywhere:
 *   POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED (expo-notifications library
 *   manifest — Android 13+ reminder visibility + re-arm after reboot),
 *   the NotificationsService boot receiver, NotificationForwarderActivity,
 *   the expo.modules.notifications.* meta-data (local reminder icon/color),
 *   the expo.modules.updates.* meta-data (expo-updates is NOT installed;
 *   ENABLED=false is a defensive default if it ever gets added), and the
 *   app's own CrashLogProvider. The androidx-injected
 *   <pkg>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION cannot be removed (it
 *   is added by the manifest merger at build time, not present in any
 *   source manifest) — it is a signature-level self-marker that grants no
 *   capability and is not a network permission.
 */
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-offline-manifest]';

// Every permission removed from EVERY variant. Direct declarations are
// deleted from the main manifest and tools:node="remove" markers are added
// so library contributions cannot re-introduce them at merge time.
const PERMISSIONS_TO_REMOVE = [
  'android.permission.INTERNET',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
];

// Exact-alarm permissions DECLARED in the main manifest for the local
// reminder system (moved here from the old release-only overlay so debug
// installs get on-time reminders too). Android 12+; harmless below.
const PERMISSIONS_TO_DECLARE = [
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM'
];

// expo-notifications' FCM push entry point. Fully-qualified class name as
// the manifest merger sees it after resolving the library's relative name.
const FCM_SERVICE_FQCN = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';

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
 * Compose the marker comment + removal/declaration block that replaces the
 * template's permission list in the main manifest. Pure function.
 */
function composeOfflinePermissionBlock() {
  const lines = [
    '  <!-- ' + TAG + ' offline guarantees applied -->',
    '  <!-- This app is FULLY OFFLINE: habit.json is synced between devices',
    '       by SEPARATE software (Syncthing) watching the data folder; the app',
    '       itself only reads and writes files locally. The five permissions',
    '       below are template baggage: deleted here AND pinned out of the',
    '       merge with tools:node="remove", so no variant (debug included)',
    '       and no future library can ever re-add them. -->'
  ];
  for (const p of PERMISSIONS_TO_REMOVE) {
    lines.push('  <uses-permission android:name="' + p + '" tools:node="remove"/>');
  }
  lines.push('  <!-- LOCAL habit reminders (expo-notifications): exact alarms so a');
  lines.push('       reminder set for 08:00 fires at 08:00. POST_NOTIFICATIONS and');
  lines.push('       RECEIVE_BOOT_COMPLETED arrive via the library manifest and are');
  lines.push('       deliberately kept. -->');
  for (const p of PERMISSIONS_TO_DECLARE) {
    lines.push('  <uses-permission android:name="' + p + '"/>');
  }
  return lines.join('\n') + '\n';
}

/**
 * Compose the FCM removal block that goes INSIDE <application>: a
 * tools:node="remove" service marker pulling the (never-configured, but
 * network-named) FirebaseMessagingService out of the merged manifest.
 * Pure function.
 */
function composeFcmRemovalBlock() {
  return [
    '    <!-- ' + TAG + ': push notifications are never used — remove the FCM',
    '         receiver from the merge so no Firebase service ships at all. -->',
    '    <service android:name="' + FCM_SERVICE_FQCN + '" tools:node="remove"/>'
  ].join('\n') + '\n';
}

/**
 * Apply ALL main-manifest transformations (dangerous-mod stage: raw template
 * text). Pure string function — unit-tested against the real template
 * layout (comments inside the queries block, space-padded self-closing
 * tags). Throws (loud, early) when the template layout changed upstream,
 * rather than silently shipping network permissions. Idempotent against
 * BOTH raw-template and post-serialization forms — guards never rely on
 * comments, because the androidManifest chain strips them.
 */
function patchMainManifest(contents) {
  let out = contents;

  // 1. delete the five direct permission declarations (no-op if absent)
  for (const p of PERMISSIONS_TO_REMOVE) {
    out = stripPermissionLines(out, p);
  }

  // 2. insert removal markers + exact-alarm declarations right after the
  //    opening <manifest …> tag — unless a previous pass already inserted
  //    them (guard on the INTERNET marker ELEMENT, not a comment).
  if (!out.includes(INTERNET_REMOVE_MARKER)) {
    const manifestOpen = out.match(/<manifest[^>]*>/);
    if (!manifestOpen) {
      throw new Error(TAG + ' <manifest> opening tag not found — template layout changed upstream; offline guarantees NOT applied');
    }
    out = out.replace(manifestOpen[0], manifestOpen[0] + '\n' + composeOfflinePermissionBlock());
  }

  // 3. drop the https-browsable queries block (no-op if absent)
  out = stripHttpsQueriesBlock(out);

  // 4. drop the firebase push meta-data (no-op if absent — the
  //    withAndroidManifest stage below removes them even when they are
  //    re-added later in the pipeline)
  for (const key of FIREBASE_META_KEYS) {
    out = stripMetaData(out, key);
  }

  // 5. pull the FCM service out of the merge from inside <application>
  if (!out.includes(FCM_SERVICE_FQCN)) {
    if (!out.includes('<application')) {
      throw new Error(TAG + ' <application> not found — template layout changed upstream; offline guarantees NOT applied');
    }
    out = out.replace(/<application[^>]*>/, m => m + '\n' + composeFcmRemovalBlock());
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
          PERMISSIONS_TO_REMOVE.length + ' permissions removed from EVERY variant' +
          ' (INTERNET included), FCM service + firebase meta-data pulled from the merge,' +
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
module.exports.composeFcmRemovalBlock = composeFcmRemovalBlock;
module.exports.removeFirebaseMetaData = removeFirebaseMetaData;
module.exports.removeHttpsQueries = removeHttpsQueries;
module.exports.composeCleanVariantOverlay = composeCleanVariantOverlay;
module.exports.ensureCleanVariantOverlay = ensureCleanVariantOverlay;
module.exports.removeReleaseOverlay = removeReleaseOverlay;
module.exports.PERMISSIONS_TO_REMOVE = PERMISSIONS_TO_REMOVE;
module.exports.PERMISSIONS_TO_DECLARE = PERMISSIONS_TO_DECLARE;
module.exports.FCM_SERVICE_FQCN = FCM_SERVICE_FQCN;
module.exports.FIREBASE_META_KEYS = FIREBASE_META_KEYS;
module.exports.INTERNET_REMOVE_MARKER = INTERNET_REMOVE_MARKER;
module.exports.TAG = TAG;
