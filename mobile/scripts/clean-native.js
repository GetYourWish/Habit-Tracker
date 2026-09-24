#!/usr/bin/env node
// clean-native.js — one-command repair for Windows native (C++/CMake) build
// failures, primarily:
//
//   Task :react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
//   C/C++: ninja: error: manifest 'build.ninja' still dirty after 100 tries
//
// What that error actually is: ninja regenerated its build manifest and the
// manifest STILL looked out of date on the next check, 100 times in a row.
//
// Two things have to happen for assembleRelease to get past it:
//   1. Patch reanimated/worklets CMakeLists so ninja stops regenerating
//      forever (CONFIGURE_DEPENDS + Windows). See plugins/patch-windows-cmake.js.
//      That patch is also applied by npm postinstall and by prebuild; it is
//      re-applied here so `git pull` + this script + assembleRelease is
//      enough — you do not have to re-run prebuild.
//   2. Wipe the already-generated .cxx scratch dirs. A dirty build.ninja
//      left by a previous failed run will keep failing until it is deleted,
//      even after the CMakeLists patch.
//
// Other documented triggers (ninja/cmake issue trackers, CMake discourse)
// that wiping also covers:
//   1. a stale / half-written .cxx scratch dir left by an interrupted build
//      (Ctrl+C, laptop sleep, OOM) — the most common first-offender,
//   2. antivirus real-time scanning re-writing file timestamps the moment
//      ninja creates them (Windows Defender on the project folder),
//   3. system clock jumps (unsynced RTC / fast startup).
// If the error comes straight back AFTER a patched + wiped rebuild, the
// README ("Android build troubleshooting") has the Defender-exclusion ladder.
//
// Scope is deliberately surgical: the CMakeLists/gradle.kts patches are
// in-place edits of two autolinked libraries, and ONLY cache/output
// directories are deleted. Nothing downloaded, nothing source-controlled,
// nothing user-authored.
//
// v1.0.7 build fix: also re-applies the expo-modules-core ReactCommon include
// patch (plugins/patch-expo-reactcommon-include.js) and wipes
// expo-modules-core's .cxx, whose full recompile is what surfaced
// "fatal error: 'jserrorhandler/ErrorUtils.h' file not found" after
// react-native-worklets was removed from the app.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { patchWindowsCmake } = require('../plugins/patch-windows-cmake')
const { patchExpoReactCommonInclude } = require('../plugins/patch-expo-reactcommon-include')
const { patchAppBuildGradle } = require('../plugins/with-standalone-release')

// The only autolinked libraries in this workspace that compile C/C++ through
// CMake+ninja (their android/ folders carry CMakeLists.txt). Every other
// dependency ships as JVM bytecode and cannot produce this failure.
// expo-modules-core: the jserrorhandler fix (plugins/patch-expo-reactcommon-include.js)
// edits its cmake/common.cmake — wiping its .cxx forces the reconfigure that
// picks the patched include path up. reanimated/worklets were removed from
// the app in v1.0.7 but stay listed so a stale tree still gets cleaned.
const NATIVE_CMAKE_LIBS = ['expo-modules-core', 'react-native-reanimated', 'react-native-worklets']

const MOBILE_ROOT = path.resolve(__dirname, '..')

function exists(p) {
  try {
    fs.statSync(p)
    return true
  } catch (e) {
    return false
  }
}

function findLibAndroidDir(mobileRoot, libName) {
  // npm workspaces: the lib may be hoisted to the repo root or nested in
  // mobile/node_modules — check both, mobile-first.
  const candidates = [
    path.join(mobileRoot, 'node_modules', libName, 'android'),
    path.join(mobileRoot, '..', 'node_modules', libName, 'android')
  ]
  for (const c of candidates) if (exists(c)) return c
  return null
}

// Pure path computation — exported for unit tests. Returns an array of
// { path, kind } for every existing cache dir that should be wiped.
function collectTargets({ mobileRoot, androidRoot }) {
  const targets = []
  if (androidRoot && exists(androidRoot)) {
    // app build outputs, the app CMake scratch (.cxx — New Arch codegen
    // for safe-area-context etc. lives here, NOT under the library), and
    // the root project's build dir. No sources live in any of these.
    for (const rel of ['app/build', 'app/.cxx', 'build']) {
      const dir = path.join(androidRoot, rel)
      if (exists(dir)) targets.push({ path: dir, kind: rel === 'app/.cxx' ? 'app-cmake-cache' : 'app-build-cache' })
    }
  }
  for (const lib of NATIVE_CMAKE_LIBS) {
    const libAndroid = findLibAndroidDir(mobileRoot, lib)
    if (!libAndroid) continue
    for (const rel of ['.cxx', 'build']) {
      const dir = path.join(libAndroid, rel)
      if (exists(dir)) targets.push({ path: dir, kind: lib + '-cmake-cache' })
    }
  }
  return targets
}

// Exported for tests: deletes each dir, returns the failures.
function removeAll(targets) {
  const failures = []
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true })
    } catch (e) {
      failures.push({ path: t.path, error: e.message })
    }
  }
  return failures
}

function stopGradleDaemons(androidRoot) {
  if (!androidRoot || !exists(androidRoot)) {
    return { ran: false, note: 'no android/ folder (run prebuild first) — nothing to stop' }
  }
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const wrapperPath = path.join(androidRoot, wrapper)
  if (!exists(wrapperPath)) return { ran: false, note: 'no Gradle wrapper in android/ — skipping' }
  const res = spawnSync(wrapperPath, ['--stop'], {
    cwd: androidRoot,
    shell: process.platform === 'win32',
    stdio: 'pipe',
    encoding: 'utf8'
  })
  if (res.status === 0) return { ran: true, note: 'Gradle daemons stopped (releases file locks)' }
  return { ran: false, note: 'gradlew --stop failed' + (res.error ? ': ' + res.error.message : '') }
}

// `clean:native` is the documented recovery command before invoking Gradle
// directly. Repair generated Gradle plugin output here as well, because a
// malformed marker-delimited block prevents Gradle from parsing build.gradle
// and this command intentionally does not delete the whole android folder.
function repairStandaloneReleaseGradle(androidRoot) {
  if (!androidRoot || !exists(androidRoot)) {
    return { repaired: false, note: 'no android/ folder (run prebuild first) — no standalone-release Gradle block to repair' }
  }
  const appGradleFile = path.join(androidRoot, 'app', 'build.gradle')
  if (!exists(appGradleFile)) {
    return { repaired: false, note: 'no android/app/build.gradle — no standalone-release Gradle block to repair' }
  }
  const original = fs.readFileSync(appGradleFile, 'utf8')
  const { contents, warnings } = patchAppBuildGradle(original)
  if (contents === original) {
    return { repaired: false, note: 'standalone-release Gradle block is already current' }
  }
  fs.writeFileSync(appGradleFile, contents)
  return {
    repaired: true,
    note: 'repaired generated standalone-release Gradle configuration' +
      (warnings.length ? ' (warnings: ' + warnings.join('; ') + ')' : '')
  }
}

function main() {
  const androidRoot = path.join(MOBILE_ROOT, 'android')
  console.log('[clean-native] mobile root: ' + MOBILE_ROOT)

  const standaloneRelease = repairStandaloneReleaseGradle(androidRoot)
  console.log('[clean-native] ' + standaloneRelease.note)

  // Apply the CMakeLists patch first so the NEXT cmake configure (after we
  // wipe .cxx) writes a ninja manifest that does not loop.
  const cmake = patchWindowsCmake(MOBILE_ROOT)
  if (cmake.patched > 0) {
    console.log('[clean-native] Windows CMake ninja fix applied to ' + cmake.patched + ' file(s)')
  } else if (cmake.alreadyOk > 0) {
    console.log('[clean-native] Windows CMake ninja fix already present')
  } else if (cmake.missing.length > 0) {
    console.log('[clean-native] CMake patch skipped (not installed: ' + cmake.missing.join(', ') + ')')
  }

  // Re-apply the jserrorhandler/ReactCommon include patch (v1.0.7 build fix):
  // npm install already applies it, but git pull + clean:native alone must be
  // enough too. Must run BEFORE the .cxx wipe below is rebuilt.
  const rci = patchExpoReactCommonInclude(MOBILE_ROOT)
  if (rci.patched > 0) {
    console.log('[clean-native] expo-modules-core ReactCommon include patch applied')
  } else if (rci.alreadyOk > 0) {
    console.log('[clean-native] expo-modules-core ReactCommon include patch already present')
  }
  if (!rci.ok) {
    return 1 // patcher already printed the exact build failure this prevents
  }

  const stop = stopGradleDaemons(androidRoot)
  console.log('[clean-native] ' + stop.note)

  const targets = collectTargets({ mobileRoot: MOBILE_ROOT, androidRoot })
  if (targets.length === 0) {
    console.log('[clean-native] nothing to clean — native caches are already empty')
    console.log('[clean-native] If the ninja error still appears on a fresh build, see the README:')
    console.log('[clean-native]   "Android build troubleshooting"')
    return 0
  }
  for (const t of targets) console.log('[clean-native] removing [' + t.kind + '] ' + t.path)

  const failures = removeAll(targets)
  if (failures.length > 0) {
    for (const f of failures) {
      console.error('[clean-native] FAILED to remove ' + f.path + ' — ' + f.error)
    }
    console.error('[clean-native] Files are locked: close Android Studio, close other terminals,')
    console.error('[clean-native] then run this script again.')
    return 1
  }
  console.log('[clean-native] done — ' + targets.length + ' cache dir(s) removed')
  console.log('[clean-native] Now rebuild:')
  console.log('[clean-native]   cd mobile/android && gradlew assembleRelease')
  console.log('[clean-native] If the SAME ninja error appears immediately again, the cause is')
  console.log('[clean-native] antivirus interference — follow the README section:')
  console.log('[clean-native]   "Android build troubleshooting" -> Windows Defender exclusion')
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { collectTargets, removeAll, NATIVE_CMAKE_LIBS, findLibAndroidDir, repairStandaloneReleaseGradle }
