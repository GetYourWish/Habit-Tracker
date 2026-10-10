/**
 * Local Expo config plugin: make EVERY installable build standalone and
 * unmistakable.
 *
 * Problem it solves (observed three times, 2026-09-15..17): the user installs
 * a DEBUG APK and sees React Native's red "Unable to load script. Make sure
 * you're running Metro or that your bundle 'index.android.bundle' is packaged
 * correctly for release" screen.
 *
 * Why that screen appears — verified against react-native 0.87.1 + expo 57
 * sources:
 *   - expo-modules ExpoReactHostFactory.kt builds the JS bundle loader as
 *     JSBundleLoader.createAssetLoader("assets://index.android.bundle") for
 *     EVERY build (debug included) — unless a host handler (expo-dev-launcher,
 *     not installed here) supplies its own. On cold start the app therefore
 *     always tries to read the bundle from its own APK first.
 *   - @react-native/gradle-plugin TaskConfiguration.kt only registers
 *     `createBundle<Variant>JsAndAssets` for variants NOT listed in
 *     `debuggableVariants` (default: ["debug", "debugOptimized"]). A debug APK
 *     shipped with NO JS at all — the red screen was the expected result,
 *     Metro or not (the loader never consults Metro in this setup; the Metro
 *     text on the screen is loader boilerplate).
 *
 * Three changes, applied at prebuild time (mobile/android is generated output;
 * config plugins are the sanctioned way to change it):
 *
 *   1. `debuggableVariants = []` in the react{} block of app/build.gradle —
 *      the JS bundle (production Hermes bytecode, devEnabled=false) is now
 *      embedded in EVERY variant. A debug APK boots standalone exactly like
 *      a release APK. (It is still large — unstripped native code — and
 *      slower; release remains the recommended daily build.)
 *
 *   2. NO debug identity changes anymore (revised 2026-10-10 after user
 *      feedback: "the APK shows as 'Habit Tracker DEBUG'"). The versionName
 *      suffix ("-debug") and the debug-only launcher-name overlay
 *      ("... DEBUG") were originally added to tell side-by-side installs
 *      apart, but they make every debug build look like a broken or
 *      unofficial app. Since android/app/build.gradle now signs the RELEASE
 *      variant with the debug keystore (Expo template default) and
 *      debuggableVariants = [] makes debug APKs standalone, both variants
 *      behave identically for the user — so both must LOOK identical too:
 *      same launcher name, same version string. If you ever install both at
 *      once, tell them apart by the file path (apk/release/ vs apk/debug/),
 *      not by the launcher label. patchDebugStringsXml/composeDebugAppName
 *      remain exported for reference/tests only; nothing calls them.
 *
 *   3. verifyStandaloneApk / verifyStandaloneApkDebug
 *      tasks wired to assembleRelease / assembleDebug: they open each APK as
 *      a zip and assert assets/index.android.bundle is present and >= 1 MB.
 *      Success prints a loud banner with the exact install command; failure
 *      fails the BUILD with a clear explanation — instead of a red screen on
 *      the phone minutes later.
 *
 * Idempotent: all edits are guarded; re-running prebuild is a no-op.
 * Self-disabling: if the Expo template stops matching the expected patterns,
 * the plugin logs a warning and leaves the file untouched rather than
 * corrupting it.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-standalone-release]';
const MARKER_OPEN = '// >>> with-standalone-release (mobile/plugins/with-standalone-release.js)';
const MARKER_CLOSE = '// <<< with-standalone-release';
const BUNDLE_ENTRY = 'assets/index.android.bundle';
const BUNDLE_MIN_BYTES = '1000000L'; // real Hermes bundles for this app are ~2.8 MB
// A real icon TTF is ~350 KB+; anything smaller is a broken/partial font.
const FONT_MIN_BYTES = '50000';

/**
 * Escape a JS string for use INSIDE a Groovy double-quoted literal:
 * backslashes first, then double quotes. Every dynamic value interpolated
 * into a generated Groovy "..." string MUST pass through this.
 *
 * History (both were real build-breaking bugs — never reintroduce either):
 *   - GString ${} inside generated println strings (fixed by using string
 *     concatenation),
 *   - raw double quotes inside the injected text: the red-screen note
 *     ('the red "Unable to load script" screen') and the debug banner
 *     ('shows as "... DEBUG" on the launcher') terminated the Groovy string
 *     early, so the generated app/build.gradle failed to COMPILE with
 *     "226: Unexpected input" and gradlew assembleRelease died before
 *     building anything (2026-09-21).
 */
function groovyEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the Gradle block for one variant's verify task. Pure string function
 * so it can be unit-tested without Gradle. All dynamic Groovy values use
 * string concatenation (GString ${} inside generated println strings was the
 * earlier JS-escaping bug — never reintroduce it), and every value placed
 * inside a Groovy "..." literal is escaped with groovyEscape() — never
 * reintroduce raw quotes either.
 *
 * The APK path is resolved at CONFIGURATION time (config-cache safe); the
 * task body only touches files and prints.
 */
function composeVariantVerifyBlock({ taskName, assembleTask, apkRelPath, debug }) {
  const apkFileVar = debug ? 'standaloneDebugApkFile' : 'standaloneApkFile';
  const label = debug ? 'STANDALONE DEBUG APK VERIFIED' : 'STANDALONE APK VERIFIED';
  const notFoundNote = debug
    ? 'app-debug.apk not found (did assembleDebug fail earlier?) - nothing to verify.'
    : 'app-release.apk not found (did assembleRelease fail earlier?) - nothing to verify.';
  const missingBundleReason = debug
    ? 'it would show the red "Unable to load script" screen on the device. The debug JS bundling task ' +
      '(createBundleDebugJsAndAssets, enabled by debuggableVariants = []) did not run or was not merged into the APK. ' +
      'Run: gradlew clean assembleDebug'
    : 'it would show the red "Unable to load script" screen on the device. The release JS bundling task ' +
      '(createBundleReleaseJsAndAssets) did not run or was not merged into the APK. ' +
      'Run: gradlew clean assembleRelease';
  const cleanHint = debug ? 'gradlew clean assembleDebug' : 'gradlew clean assembleRelease';
  // Icon font check (the 2026-09-22 "blank spaces instead of icons"
  // incident): the MaterialCommunityIcons TTF is embedded into
  // assets/fonts/ by plugins/with-icon-font.js (prebuild) and
  // plugins/embed-icon-font.js (postinstall, stale-folder repair). The
  // font is loaded straight from APK assets by ReactFontManager - if it
  // is missing from the APK, EVERY icon renders as a blank space and every
  // icon-only button becomes an invisible touch target.
  const fontMissingReason =
    'every icon in the app would render blank and icon-only buttons would turn ' +
    'invisible. The embedded font comes from plugins/with-icon-font.js at prebuild ' +
    'time (or plugins/embed-icon-font.js from npm postinstall). Re-run: npm install, ' +
    'then ' + cleanHint;
  const bannerNote = debug
    ? 'NOTE: debug APKs are large (unstripped native code, all CPU architectures) - that is normal. ' +
      'For daily use prefer app-release.apk. Both variants share the same launcher name and ' +
      'version string on purpose (2026-10-10): tell them apart by the apk/debug vs apk/release ' +
      'output folder, not by the label.'
    : 'TIP: assembleDebug also bundles the JS these days, but debug APKs are large and unoptimized - ' +
      'prefer this app-release.apk for daily use.';

  return (
    MARKER_OPEN + '\n' +
    '// Verify that the built APK embeds the JS bundle. With debuggableVariants = []\n' +
    '// EVERY variant must contain assets/index.android.bundle (ExpoReactHostFactory\n' +
    '// loads exactly that asset on cold start); a bundle-less APK fails here, at\n' +
    '// build time, instead of red-screening on the device after install.\n' +
    'def ' + apkFileVar + ' = new File(layout.buildDirectory.get().asFile, "' + groovyEscape(apkRelPath) + '")\n' +
    'tasks.register("' + groovyEscape(taskName) + '") {\n' +
    '    doLast {\n' +
    '        if (!' + apkFileVar + '.exists()) {\n' +
    '            println "' + groovyEscape(TAG + ' ' + notFoundNote) + '"\n' +
    '            return\n' +
    '        }\n' +
    '        def bundleMinBytes = ' + BUNDLE_MIN_BYTES + '\n' +
    '        def apk\n' +
    '        try {\n' +
    '            apk = new java.util.zip.ZipFile(' + apkFileVar + ')\n' +
    '        } catch (java.util.zip.ZipException e) {\n' +
    '            throw new GradleException(\n' +
    '                "' + groovyEscape(TAG) + ' " + ' + apkFileVar + '.name + " is not a readable APK/zip (" + e.getMessage() + "). " +\n' +
    '                "The packaging step likely produced a corrupt file - run: ' + groovyEscape(cleanHint) + '"\n' +
    '            )\n' +
    '        }\n' +
    '        try {\n' +
    '            def entry = apk.getEntry("' + groovyEscape(BUNDLE_ENTRY) + '")\n' +
    '            if (entry == null) {\n' +
    '                throw new GradleException(\n' +
    '                    "' + groovyEscape(TAG) + ' " + ' + apkFileVar + '.name + " does NOT contain ' + groovyEscape(BUNDLE_ENTRY) + ' - ' + groovyEscape(missingBundleReason) + '"\n' +
    '                )\n' +
    '            }\n' +
    '            if (entry.getSize() < bundleMinBytes) {\n' +
    '                throw new GradleException(\n' +
    '                    "' + groovyEscape(TAG + ' ' + BUNDLE_ENTRY) + ' is only " + entry.getSize() + " bytes - too small to be " +\n' +
    '                    "the real Hermes bundle. Run: ' + groovyEscape(cleanHint) + '"\n' +
    '                )\n' +
    '            }\n' +
    '            def fontEntry = apk.entries().findAll { it.getName().startsWith("assets/fonts/") && it.getName().endsWith(".ttf") }\n' +
    '                .findAll { it.getSize() > ' + FONT_MIN_BYTES + 'L }\n' +
    '                .find()\n' +
    '            if (fontEntry == null) {\n' +
    '                throw new GradleException(\n' +
    '                    "' + groovyEscape(TAG) + ' " + ' + apkFileVar + '.name + " has NO icon font under assets/fonts/ - ' + groovyEscape(fontMissingReason) + '"\n' +
    '                )\n' +
    '            }\n' +
    '            def fontKb = String.format(\'%.0f\', fontEntry.getSize() / 1024.0)\n' +
    '            def bundleMb = String.format(\'%.1f\', entry.getSize() / (1024.0 * 1024.0))\n' +
    '            def apkMb = String.format(\'%.1f\', ' + apkFileVar + '.length() / (1024.0 * 1024.0))\n' +
    '            println ""\n' +
    '            println "' + groovyEscape(TAG) + ' ================================================================"\n' +
    '            println "' + groovyEscape(TAG + ' ' + label + ' - ' + BUNDLE_ENTRY) + ' present (" + bundleMb + " MB)"\n' +
    '            println "' + groovyEscape(TAG) + ' icon font present: " + fontEntry.getName() + " (" + fontKb + " KB)"\n' +
    '            println "' + groovyEscape(TAG) + ' APK: " + ' + apkFileVar + '.absolutePath + " (" + apkMb + " MB)"\n' +
    '            println "' + groovyEscape(TAG) + ' Install it on the device with:"\n' +
    '            println "' + groovyEscape(TAG) + '     adb install -r \\"" + ' + apkFileVar + '.absolutePath + "\\""\n' +
    '            println "' + groovyEscape(TAG + ' ' + bannerNote) + '"\n' +
    '            println "' + groovyEscape(TAG) + ' ================================================================"\n' +
    '        } finally {\n' +
    '            apk.close()\n' +
    '        }\n' +
    '    }\n' +
    '}\n' +
    'tasks.matching { it.name == "' + groovyEscape(assembleTask) + '" }.configureEach { it.finalizedBy "' + groovyEscape(taskName) + '" }\n' +
    MARKER_CLOSE + '\n'
  );
}

/**
 * Both variants: release (recommended daily build) + debug (now bundles too).
 */
function composeVerifyBlock() {
  return (
    '\n' +
    composeVariantVerifyBlock({
      taskName: 'verifyStandaloneApk',
      assembleTask: 'assembleRelease',
      apkRelPath: 'outputs/apk/release/app-release.apk',
      debug: false
    }) +
    composeVariantVerifyBlock({
      taskName: 'verifyStandaloneApkDebug',
      assembleTask: 'assembleDebug',
      apkRelPath: 'outputs/apk/debug/app-debug.apk',
      debug: true
    })
  );
}

/**
 * The debug buildType's on-launcher name. "Habit Tracker" -> "Habit Tracker DEBUG".
 */
function composeDebugAppName(mainName) {
  return (mainName || 'Habit Tracker') + ' DEBUG'
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Compose (or patch) android/app/src/debug/res/values/strings.xml so the
 * DEBUG variant shows a distinct launcher name. Pure function:
 *   contents == null  -> fresh overlay file
 *   otherwise         -> replace the existing app_name value, or insert one
 *                          before </resources>; anything else is left intact
 * Returns { contents, changed }; changed=false signals "leave the file alone".
 *
 * RETIRED (2026-10-10): the plugin no longer creates this overlay — debug
 * installs must look identical to release ones ("... DEBUG" on the launcher
 * read as a broken/unofficial build). Kept exported for tests/history only.
 */
function patchDebugStringsXml(contents, debugAppName) {
  const nameLine = '<string name="app_name">' + escapeXml(debugAppName) + '</string>'
  if (contents == null || contents.trim() === '') {
    return {
      contents: '<resources>\n  <string name="app_name">' + escapeXml(debugAppName) + '</string>\n</resources>\n',
      changed: true
    }
  }
  const appRe = /<string name="app_name"[^>]*>[\s\S]*?<\/string>/
  if (appRe.test(contents)) {
    const next = contents.replace(appRe, nameLine)
    return { contents: next, changed: next !== contents }
  }
  if (contents.includes('</resources>')) {
    return {
      contents: contents.replace('</resources>', '  ' + nameLine + '\n</resources>'),
      changed: true
    }
  }
  return { contents, changed: false }
}

/**
 * Patch the generated android/app/build.gradle. Pure string function.
 * Returns { contents, warnings } so callers and tests can assert exactly what
 * happened.
 *
 * NOTE (2026-10-10): this no longer injects `versionNameSuffix "-debug"` into
 * the debug buildType. The user explicitly asked for debug installs to look
 * like normal ones ("why does the APK have the app name plus DEBUG?"). Debug
 * builds are still standalone (debuggableVariants = []), so there is nothing
 * about them a daily user must see on the launcher or in Android Settings.
 */
function patchAppBuildGradle(contents) {
  const warnings = [];
  let result = contents;

  // --- 0. strip any legacy versionNameSuffix "-debug" ------------------------
  // Injected by older versions of this plugin (and possibly by hand). Remove
  // it so debug installs show the plain version name, exactly like release.
  if (/^\s*versionNameSuffix\s+"-debug"\s*$/m.test(result)) {
    result = result.replace(/^[ \t]*versionNameSuffix[ \t]+"-debug"[ \t]*\r?\n/gm, '');
    console.log(
      `${TAG} removed the legacy versionNameSuffix "-debug" (debug installs now show the plain version name, like release)`
    );
  } else if (/versionNameSuffix/.test(result)) {
    console.log(
      `${TAG} a non-debug versionNameSuffix is present in app/build.gradle - leaving it untouched`
    );
  }

  // --- 2. debuggableVariants = [] in the react{} block -----------------------
  // The RN gradle plugin skips JS bundling for variants listed here (default
  // ["debug", "debugOptimized"]). Empty the list so EVERY APK embeds the
  // standalone bundle. Commented-out template occurrences ("// debuggable...") do not count.
  if (/^\s*debuggableVariants\s*=/m.test(result)) {
    console.log(
      `${TAG} an active debuggableVariants assignment is already present - leaving it untouched`
    );
  } else {
    const reactBlockRe = /(^|\n)(react\s*\{\r?\n)/;
    if (reactBlockRe.test(result)) {
      result = result.replace(
        reactBlockRe,
        `$1$2` +
          `    // >>> with-standalone-release: debug builds MUST bundle the JS too\n` +
          `    // ExpoReactHostFactory always loads assets://index.android.bundle on\n` +
          `    // cold start - an unbundled debug APK can never start, Metro or not.\n` +
          `    debuggableVariants = []\n` +
          `    // <<< with-standalone-release\n`
      );
      console.log(
        `${TAG} injected debuggableVariants = [] (debug APKs now embed the standalone JS bundle instead of red-screening)`
      );
    } else {
      warnings.push(
        'react { block not found in app/build.gradle - template layout changed upstream; debuggableVariants NOT injected (debug APKs will need Metro!)'
      );
    }
  }

  // --- 3. verify tasks for BOTH variants -----------------------------------
  // Replace an existing marker-delimited block instead of merely accepting it.
  // This deliberately self-heals native folders generated by an earlier
  // plugin version: in particular, the 2026-09-21 block with unescaped quotes
  // cannot be parsed by Gradle, so Expo cannot get far enough to regenerate it.
  if (result.includes(MARKER_OPEN)) {
    // composeVerifyBlock has one marker pair per variant. Remove every
    // complete old pair, then append the current complete pair set.
    let withoutBlocks = result;
    let removedBlock = false;
    let malformedBlock = false;
    while (true) {
      const blockStart = withoutBlocks.indexOf(MARKER_OPEN);
      if (blockStart === -1) break;
      const blockEnd = withoutBlocks.indexOf(MARKER_CLOSE, blockStart);
      if (blockEnd === -1) {
        malformedBlock = true;
        break;
      }
      withoutBlocks = withoutBlocks.slice(0, blockStart) + withoutBlocks.slice(blockEnd + MARKER_CLOSE.length);
      removedBlock = true;
    }
    if (malformedBlock) {
      warnings.push(
        'with-standalone-release marker is missing its closing marker - verify tasks were not replaced to avoid deleting unknown Gradle content'
      );
    } else {
      const refreshed = withoutBlocks.trimEnd() + '\n' + composeVerifyBlock();
      if (refreshed === result) {
        console.log(
          `${TAG} verifyStandaloneApk block is current in app/build.gradle - leaving it untouched`
        );
      } else if (removedBlock) {
        result = refreshed;
        console.log(
          `${TAG} refreshed verifyStandaloneApk block in app/build.gradle to repair an older generated block`
        );
      }
    }
  } else {
    result = result.trimEnd() + '\n' + composeVerifyBlock();
    console.log(
      `${TAG} appended verifyStandaloneApk + verifyStandaloneApkDebug (assembleRelease/assembleDebug.finalizedBy) - a bundle-less APK now fails the build instead of red-screening on the device`
    );
  }

  return { contents: result, warnings };
}

function withStandaloneRelease(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const appGradleFile = path.join(projectRoot, 'android', 'app', 'build.gradle');
      if (!fs.existsSync(appGradleFile)) {
        throw new Error(
          `${TAG} ${appGradleFile} not found after prebuild. The android template layout may have changed upstream.`
        );
      }
      const original = fs.readFileSync(appGradleFile, 'utf8');
      const { contents, warnings } = patchAppBuildGradle(original);
      for (const warning of warnings) {
        console.warn(`${TAG} WARNING: ${warning}`);
      }
      if (contents !== original) {
        fs.writeFileSync(appGradleFile, contents);
      }

      // --- legacy debug launcher-name overlay: REMOVE it ---------------------
      // Older versions of this plugin wrote app/src/debug/res/values/strings.xml
      // with <string name="app_name">Habit Tracker DEBUG</string>, so every
      // debug install showed "…DEBUG" on the launcher. The user asked for the
      // plain name in every build (2026-10-10): delete the overlay if present.
      // (prebuild --clean regenerates android/, but a non-clean prebuild or a
      // hand-kept native folder must still self-heal.)
      const debugStringsFile = path.join(
        projectRoot, 'android', 'app', 'src', 'debug', 'res', 'values', 'strings.xml'
      );
      if (fs.existsSync(debugStringsFile)) {
        try {
          fs.rmSync(debugStringsFile);
          console.log(
            `${TAG} removed the legacy "... DEBUG" launcher-name overlay (${debugStringsFile}) - debug installs now show "Habit Tracker" like every other build`
          );
        } catch (e) {
          console.warn(`${TAG} WARNING: could not delete ${debugStringsFile}: ${e.message}`);
        }
      }
      return config;
    },
  ]);
}

module.exports = withStandaloneRelease;
module.exports.patchAppBuildGradle = patchAppBuildGradle;
module.exports.composeVerifyBlock = composeVerifyBlock;
module.exports.groovyEscape = groovyEscape;
module.exports.patchDebugStringsXml = patchDebugStringsXml;
module.exports.composeDebugAppName = composeDebugAppName;
module.exports.TAG = TAG;
