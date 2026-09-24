// Unit tests for mobile/scripts/clean-native.js
//
// The script is the one-command repair for the Windows C++ build failure
//   "ninja: error: manifest 'build.ninja' still dirty after 100 tries"
// which lives in the CMake scratch dirs (.cxx) of react-native-reanimated /
// react-native-worklets. collectTargets() must find exactly those caches —
// in BOTH npm-workspaces layouts (nested mobile/node_modules and hoisted
// root node_modules) — and removeAll() must delete them without touching
// anything else.

const fs = require('fs')
const os = require('os')
const path = require('path')

const { collectTargets, removeAll, NATIVE_CMAKE_LIBS, findLibAndroidDir, repairStandaloneReleaseGradle } = require('../scripts/clean-native.js')

let tmp

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true })
}

function touch(p, content = 'x') {
  mkdirp(path.dirname(p))
  fs.writeFileSync(p, content)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-native-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeLayout({ hoisted }) {
  const mobileRoot = path.join(tmp, 'mobile')
  const androidRoot = path.join(mobileRoot, 'android')
  const nm = hoisted ? path.join(tmp, 'node_modules') : path.join(mobileRoot, 'node_modules')
  mkdirp(androidRoot)
  for (const lib of NATIVE_CMAKE_LIBS) {
    touch(path.join(nm, lib, 'android', 'CMakeLists.txt'))
  }
  // realistic caches
  touch(path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'))
  touch(path.join(androidRoot, 'build', 'noise.txt'))
  for (const lib of NATIVE_CMAKE_LIBS) {
    touch(path.join(nm, lib, 'android', '.cxx', 'RelWithDebInfo', 'arm64-v8a', 'build.ninja'))
    touch(path.join(nm, lib, 'android', 'build', 'lib.so'))
  }
  return { mobileRoot, androidRoot, nm }
}

describe('clean-native collectTargets', () => {
  test('finds app build caches + both libraries\u2019 .cxx and build dirs (nested layout)', () => {
    const { mobileRoot, androidRoot, nm } = makeLayout({ hoisted: false })
    const targets = collectTargets({ mobileRoot, androidRoot })
    const paths = targets.map(t => t.path)
    expect(paths).toContain(path.join(androidRoot, 'app', 'build'))
    expect(paths).toContain(path.join(androidRoot, 'build'))
    for (const lib of NATIVE_CMAKE_LIBS) {
      expect(paths).toContain(path.join(nm, lib, 'android', '.cxx'))
      expect(paths).toContain(path.join(nm, lib, 'android', 'build'))
    }
    expect(targets.length).toBe(2 + 2 * NATIVE_CMAKE_LIBS.length)
    // every target carries a human-readable kind
    for (const t of targets) expect(typeof t.kind).toBe('string')
  })

  test('finds the libraries when npm hoisted them to the repo root', () => {
    const { mobileRoot, androidRoot, nm } = makeLayout({ hoisted: true })
    const targets = collectTargets({ mobileRoot, androidRoot })
    const paths = targets.map(t => t.path)
    for (const lib of NATIVE_CMAKE_LIBS) {
      expect(paths).toContain(path.join(nm, lib, 'android', '.cxx'))
    }
  })

  test('wipes android/app/.cxx (New Arch app cmake / safe-area-context codegen)', () => {
    const { mobileRoot, androidRoot } = makeLayout({ hoisted: false })
    touch(path.join(androidRoot, 'app', '.cxx', 'RelWithDebInfo', 'arm64-v8a', 'build.ninja'))
    const targets = collectTargets({ mobileRoot, androidRoot })
    const paths = targets.map(t => t.path)
    expect(paths).toContain(path.join(androidRoot, 'app', '.cxx'))
    expect(targets.some(t => t.kind === 'app-cmake-cache')).toBe(true)
  })

  test('returns an empty list on a fresh checkout (nothing exists yet)', () => {
    const mobileRoot = path.join(tmp, 'mobile')
    mkdirp(mobileRoot)
    expect(collectTargets({ mobileRoot, androidRoot: path.join(mobileRoot, 'android') })).toEqual([])
  })

  test('tolerates a missing android/ folder (prebuild not run yet)', () => {
    const { mobileRoot, nm } = makeLayout({ hoisted: false })
    const targets = collectTargets({ mobileRoot, androidRoot: path.join(mobileRoot, 'android', 'missing') })
    const paths = targets.map(t => t.path)
    expect(paths).toContain(path.join(nm, 'react-native-reanimated', 'android', '.cxx'))
    expect(paths.every(p => !p.includes(path.join('android', 'missing')))).toBe(true)
  })

  test('findLibAndroidDir prefers mobile/node_modules over the root tree', () => {
    const mobileRoot = path.join(tmp, 'mobile')
    const rootNm = path.join(tmp, 'node_modules')
    touch(path.join(mobileRoot, 'node_modules', 'react-native-reanimated', 'android', 'build.gradle.kts'))
    touch(path.join(rootNm, 'react-native-reanimated', 'android', 'build.gradle.kts'))
    expect(findLibAndroidDir(mobileRoot, 'react-native-reanimated')).toBe(
      path.join(mobileRoot, 'node_modules', 'react-native-reanimated', 'android')
    )
  })

  test('returns null for a library that is not installed', () => {
    const mobileRoot = path.join(tmp, 'mobile')
    mkdirp(mobileRoot)
    expect(findLibAndroidDir(mobileRoot, 'not-a-real-lib')).toBeNull()
  })
})

describe('clean-native removeAll', () => {
  test('deletes every target dir recursively and reports zero failures', () => {
    const { mobileRoot, androidRoot, nm } = makeLayout({ hoisted: false })
    const targets = collectTargets({ mobileRoot, androidRoot })
    const failures = removeAll(targets)
    expect(failures).toEqual([])
    for (const t of targets) expect(fs.existsSync(t.path)).toBe(false)
    // sources are untouched
    expect(fs.existsSync(path.join(nm, 'react-native-reanimated', 'android', 'CMakeLists.txt'))).toBe(true)
    expect(fs.existsSync(path.join(androidRoot, 'app'))).toBe(true)
  })

  test('does not throw when a target vanishes between collect and remove', () => {
    const failures = removeAll([{ path: path.join(tmp, 'gone'), kind: 'x' }])
    expect(failures).toEqual([])
  })
})

describe('clean-native standalone-release Gradle repair', () => {
  test('replaces the old quote-broken generated block before Gradle runs', () => {
    const androidRoot = path.join(tmp, 'mobile', 'android')
    const appGradle = path.join(androidRoot, 'app', 'build.gradle')
    touch(appGradle, `plugins {}\n// >>> with-standalone-release (mobile/plugins/with-standalone-release.js)\ntasks.register("verifyStandaloneApk") { println "red "Unable to load script"" }\n// <<< with-standalone-release\n`)

    const result = repairStandaloneReleaseGradle(androidRoot)
    const repaired = fs.readFileSync(appGradle, 'utf8')

    expect(result.repaired).toBe(true)
    expect(repaired).toContain('red \\"Unable to load script\\"')
    expect(repaired).not.toContain('red "Unable to load script"')
  })

  test('does nothing when the Android project has not been generated', () => {
    const result = repairStandaloneReleaseGradle(path.join(tmp, 'missing-android'))
    expect(result.repaired).toBe(false)
    expect(result.note).toContain('no android/ folder')
  })
})
