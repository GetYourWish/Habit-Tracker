#!/usr/bin/env node
'use strict';

/**
 * Patches expo-modules-core's Android CMake inside node_modules:
 *
 *   Task :expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
 *   .../react-android-0.87.1-release/prefab/modules/reactnative/include/
 *     cxxreact/ErrorUtils.h:12:10: fatal error:
 *     'jserrorhandler/ErrorUtils.h' file not found
 *
 * Why this happens (verified against the real artifacts):
 *
 *   1. react-native 0.87 moved ErrorUtils to ReactCommon/jserrorhandler/ and
 *      left a deprecation shim at cxxreact/ErrorUtils.h that does nothing but
 *      `#include <jserrorhandler/ErrorUtils.h>`. That shim IS packaged into
 *      the react-android prefab `reactnative` module — but jserrorhandler/
 *      itself is NOT (ReactAndroid/build.gradle.kts PreparePrefabHeadersTask
 *      copies cxxreact/, react/**, jsi/, ... and no jserrorhandler). There is
 *      no ReactAndroid::jserrorhandler prefab target to link either.
 *   2. expo-modules-core (57.0.14, and current upstream main) still compiles
 *      EventEmitter.cpp with `#include <cxxreact/ErrorUtils.h>` and only puts
 *      ${REACT_NATIVE_DIR}/ReactCommon — the one on-disk directory that HAS
 *      jserrorhandler/ErrorUtils.h (the react-native npm package ships it) —
 *      on the include path WHEN REACT-NATIVE-WORKLETS IS INSTALLED
 *      (android/cmake/main.cmake: `if (REACT_NATIVE_WORKLETS_DIR)`).
 *   3. Habit Tracker v1.0.7 removed react-native-worklets (with
 *      reanimated/gesture-handler/draggable-flatlist) → the conditional
 *      include dir vanished → expo-modules-core's .cxx reconfigured from
 *      scratch (new cmake args) → full recompile → the shim's redirect
 *      cannot resolve → the release build fails.
 *
 * Upstream Expo never noticed because their default template ships
 * reanimated+worklets, so the conditional include path is almost always
 * present in the wild.
 *
 * Fix: add `${REACT_NATIVE_DIR}/ReactCommon` to EXPO_COMMON (the INTERFACE
 * library both expo-modules-core and expo-modules-jsi consume) — i.e. exactly
 * what the worklets-conditional block used to provide, now unconditional.
 *
 * Verified end-to-end before shipping (2026-09-19): every translation unit of
 * expo-modules-core@57.0.14 was compiled with the user's exact clang flags
 * (NDK r27b / 27.1.12297006, arm64-v8a, RelWithDebInfo) against a prefab
 * include tree rebuilt from react-native@0.87.1's own copy list:
 *   - without the include: 57/58 compile, EventEmitter.cpp fails with the
 *     user's exact error (same file, same 12:10 position);
 *   - with the include: 58/58 compile clean.
 * Shadowing is safe: every header reachable through ReactCommon/ that also
 * exists in the prefab is the SAME file (the prefab copies are made from
 * ReactCommon), and the only additions (jserrorhandler/, jsc/, …) resolve
 * nothing else.
 *
 * Runs in THREE places so the flow is order-proof (same wiring as
 * patch-windows-cmake.js):
 *   1. npm postinstall of @habit-tracker/mobile — `npm install` restores
 *      pristine files, this immediately re-applies the patch
 *   2. every prebuild, via plugins/with-expo-reactcommon-include.js
 *   3. npm run clean:native (which also wipes expo-modules-core's .cxx so the
 *      next gradle run reconfigures with the patched CMake)
 *
 * Idempotent and anchored. If a future expo-modules-core ships its own fix
 * (or restructures cmake/common.cmake), the anchor stops matching: the patch
 * then only fails the install if the breakage is PROVABLY still present
 * (EventEmitter.cpp still includes the deprecated shim AND main.cmake still
 * gates ReactCommon on worklets) — otherwise it is a logged no-op.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[with-expo-reactcommon-include]';
const MARKER = '[pt-reactcommon-include]';

const MODULE_REL = path.join('expo-modules-core', 'android', 'cmake', 'common.cmake');

// Pristine expo-modules-core 57.0.14 (checked against the installed tarball).
const ANCHOR = [
  'target_link_libraries(',
  '  EXPO_COMMON',
  '  INTERFACE',
  '  ReactAndroid::jsi',
  '  fbjni::fbjni',
  '  ReactAndroid::reactnative',
  ')',
].join('\n');

function anchorWithEol(eol) {
  return ANCHOR.split('\n').join(eol);
}

function includeBlock(eol) {
  return [
    `# ${MARKER} react-native 0.87's react-android prefab does not ship`,
    '# jserrorhandler/ (cxxreact/ErrorUtils.h is a deprecation shim that',
    '# includes <jserrorhandler/ErrorUtils.h>), and expo only puts',
    '# ${REACT_NATIVE_DIR}/ReactCommon on the include path when',
    '# react-native-worklets is installed (cmake/main.cmake). This app',
    '# removed worklets in v1.0.7, so add it unconditionally or',
    '# :expo-modules-core:buildCMakeRelWithDebInfo fails with',
    "# \"fatal error: 'jserrorhandler/ErrorUtils.h' file not found\".",
    'target_include_directories(',
    '  EXPO_COMMON',
    '  INTERFACE',
    '  "${REACT_NATIVE_DIR}/ReactCommon"',
    ')',
  ].join(eol);
}

function detectEOL(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Pure string transform of expo-modules-core's cmake/common.cmake.
 * @returns {{ contents: string, changed: boolean, status: 'patched'|'already'|'anchor-missing' }}
 */
function patchCommonCmakeText(contents) {
  if (contents.includes(MARKER)) {
    return { contents, changed: false, status: 'already' };
  }
  const eol = detectEOL(contents);
  let anchor = anchorWithEol(eol);
  let idx = contents.indexOf(anchor);
  if (idx === -1) {
    // mixed-EOL file: try the other variant before giving up
    anchor = anchorWithEol(eol === '\n' ? '\r\n' : '\n');
    idx = contents.indexOf(anchor);
    if (idx === -1) {
      return { contents, changed: false, status: 'anchor-missing' };
    }
  }
  const insertAt = idx + anchor.length;
  const next = contents.slice(0, insertAt) + eol + includeBlock(eol) + contents.slice(insertAt);
  return { contents: next, changed: true, status: 'patched' };
}

/**
 * Is the jserrorhandler breakage provably still present in this copy of
 * expo-modules-core? (Used only when the anchor did not match, to decide
 * between "upstream fixed it — clean skip" and "cannot patch — fail loud".)
 */
function breakageStillPresent(nmDir) {
  try {
    const eventEmitter = fs.readFileSync(
      path.join(nmDir, 'expo-modules-core', 'common', 'cpp', 'EventEmitter.cpp'),
      'utf8'
    );
    const mainCmake = fs.readFileSync(
      path.join(nmDir, 'expo-modules-core', 'android', 'cmake', 'main.cmake'),
      'utf8'
    );
    return (
      eventEmitter.includes('#include <cxxreact/ErrorUtils.h>') &&
      mainCmake.includes('REACT_NATIVE_WORKLETS_DIR')
    );
  } catch {
    // Files missing -> expo restructured the package entirely; nothing we can
    // prove from here.
    return false;
  }
}

/**
 * Every existing node_modules from startDir upward (up to 5 levels).
 * npm workspaces hoist to the repo root, but a stray nested
 * <workspace>/node_modules must not make us stop looking too early.
 */
function findNodeModulesCandidates(startDir) {
  const found = [];
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(candidate)) found.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

/**
 * Patch every node_modules copy of expo-modules-core/android/cmake/common.cmake.
 * @returns {{ ok: boolean, patched: number, alreadyOk: number, unpatchable: number }}
 */
function patchExpoReactCommonInclude(startDir) {
  const result = { ok: true, patched: 0, alreadyOk: 0, unpatchable: 0 };
  const candidates = findNodeModulesCandidates(startDir);
  if (candidates.length === 0) {
    console.warn(`${TAG} skip: no node_modules found above ${startDir} (nothing to patch)`);
    return result;
  }
  console.log(`${TAG} scanning: ${candidates.join(' -> ')}`);

  let sawCommonCmake = false;
  for (const nm of candidates) {
    const file = path.join(nm, MODULE_REL);
    if (!fs.existsSync(file)) continue;
    sawCommonCmake = true;
    const original = fs.readFileSync(file, 'utf8');
    const { contents, changed, status } = patchCommonCmakeText(original);
    if (changed) {
      fs.writeFileSync(file, contents);
      result.patched += 1;
      console.log(`${TAG} patched: ReactCommon include added to EXPO_COMMON (${file})`);
    } else if (status === 'already') {
      result.alreadyOk += 1;
      console.log(`${TAG} ok: already patched (${file})`);
    } else {
      // anchor-missing: upstream restructured or fixed common.cmake
      if (breakageStillPresent(nm)) {
        result.unpatchable += 1;
        result.ok = false;
        console.warn(
          `${TAG} FAILED to patch ${file}: expected EXPO_COMMON link block not found, ` +
            `but EventEmitter.cpp still includes the cxxreact/ErrorUtils.h shim and ` +
            `main.cmake still gates ReactCommon on worklets — the C++ build WILL fail ` +
            `with 'jserrorhandler/ErrorUtils.h' file not found. ` +
            `Update plugins/patch-expo-reactcommon-include.js for the new layout.`
        );
      } else {
        result.alreadyOk += 1;
        console.log(
          `${TAG} skip: ${file} no longer matches the expected shape and the ` +
            `jserrorhandler breakage is not detectable — assuming upstream fixed it.`
        );
      }
    }
  }
  if (!sawCommonCmake) {
    console.log(
      `${TAG} skip: expo-modules-core/android/cmake/common.cmake not found in any ` +
        `node_modules (not installed yet?)`
    );
  }
  return result;
}

module.exports = {
  patchExpoReactCommonInclude,
  patchCommonCmakeText,
  breakageStillPresent,
  ANCHOR,
  MARKER,
  MODULE_REL,
  TAG,
};

if (require.main === module) {
  // Run as `node plugins/patch-expo-reactcommon-include.js` (mobile postinstall,
  // prebuild via the with- plugin, or clean:native).
  const result = patchExpoReactCommonInclude(path.join(__dirname, '..'));
  if (!result.ok) {
    process.exitCode = 1; // the build provably cannot succeed — make it impossible to miss
  }
}
