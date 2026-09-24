// Unit tests for mobile/plugins/patch-expo-reactcommon-include.js
//
// The v1.0.7 build failure this patcher covers:
//   Task :expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
//   cxxreact/ErrorUtils.h:12:10: fatal error:
//   'jserrorhandler/ErrorUtils.h' file not found
//
// Root cause: react-native 0.87's react-android prefab packages the
// cxxreact/ErrorUtils.h deprecation shim but not the jserrorhandler/ headers
// it redirects to, and expo-modules-core only adds
// ${REACT_NATIVE_DIR}/ReactCommon (the only on-disk home of those headers) to
// the include path when react-native-worklets is installed — which this app
// removed in v1.0.7.
//
// The fix: add that include to EXPO_COMMON unconditionally. Tests below pin
// the pure string transform against the REAL pristine 57.0.14 file shape, the
// idempotency fixpoint, the fs-walking patcher across both npm-workspaces
// layouts, and the "fail loud only when the breakage is provably present"
// drift semantics.

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  patchCommonCmakeText,
  patchExpoReactCommonInclude,
  breakageStillPresent,
  ANCHOR,
  MARKER,
  MODULE_REL,
} = require('../plugins/patch-expo-reactcommon-include')

// Excerpt of the REAL pristine expo-modules-core@57.0.14
// android/cmake/common.cmake (byte-identical around the anchor).
const PRISTINE_COMMON_CMAKE = `add_library(EXPO_COMMON INTERFACE)

target_precompile_headers(
  EXPO_COMMON
  INTERFACE
  \${CMAKE_SOURCE_DIR}/src/main/cpp/ExpoHeader.pch
)

target_compile_options(
  EXPO_COMMON
  INTERFACE
  --std=c++20
  \${OPTIMIZATION_FLAGS}
  -frtti
  -fexceptions
  -Wall
  -fstack-protector-all
  -DUSE_HERMES=\${USE_HERMES_INT}
  -DUNIT_TEST=\${UNIT_TEST_INT}
  -DIS_NEW_ARCHITECTURE_ENABLED=1
  -DRN_FABRIC_ENABLED=1
  -DRN_SERIALIZABLE_STATE=1
  \${folly_FLAGS}
  \${ADDITIONAL_CXX_FLAGS}
)

target_link_libraries(
  EXPO_COMMON
  INTERFACE
  ReactAndroid::jsi
  fbjni::fbjni
  ReactAndroid::reactnative
)

function(use_expo_common target_name)
  target_link_libraries(\${target_name} PRIVATE EXPO_COMMON)
endfunction()
`

let tmp

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-rci-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeNodeModules({ hoisted, alreadyPatched = false }) {
  const mobileRoot = path.join(tmp, 'mobile')
  const nm = hoisted ? path.join(tmp, 'node_modules') : path.join(mobileRoot, 'node_modules')
  const commonCmake = path.join(nm, MODULE_REL)
  fs.mkdirSync(path.dirname(commonCmake), { recursive: true })
  let contents = PRISTINE_COMMON_CMAKE
  if (alreadyPatched) {
    contents = patchCommonCmakeText(contents).contents
  }
  fs.writeFileSync(commonCmake, contents)
  // the files breakageStillPresent() looks at
  const eeDir = path.join(nm, 'expo-modules-core', 'common', 'cpp')
  fs.mkdirSync(eeDir, { recursive: true })
  fs.writeFileSync(
    path.join(eeDir, 'EventEmitter.cpp'),
    '#include "JSIUtils.h"\n#include <cxxreact/ErrorUtils.h>\n'
  )
  const mainCmake = path.join(nm, 'expo-modules-core', 'android', 'cmake', 'main.cmake')
  fs.mkdirSync(path.dirname(mainCmake), { recursive: true })
  fs.writeFileSync(mainCmake, 'if (REACT_NATIVE_WORKLETS_DIR)\n  target_include_directories()\nendif()\n')
  return { mobileRoot, nm, commonCmake }
}

describe('patchCommonCmakeText (pure transform)', () => {
  test('adds the ReactCommon include right after the EXPO_COMMON link block', () => {
    const { contents, changed, status } = patchCommonCmakeText(PRISTINE_COMMON_CMAKE)
    expect(changed).toBe(true)
    expect(status).toBe('patched')
    // anchored AFTER the link block, BEFORE use_expo_common
    const anchorIdx = contents.indexOf(ANCHOR)
    const markerIdx = contents.indexOf(MARKER)
    const helperIdx = contents.indexOf('function(use_expo_common')
    expect(anchorIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeGreaterThan(anchorIdx)
    expect(helperIdx).toBeGreaterThan(markerIdx)
    // the actual fix: the include dir on the INTERFACE library
    expect(contents).toContain('target_include_directories(')
    expect(contents).toContain('  EXPO_COMMON')
    expect(contents).toContain('  INTERFACE')
    expect(contents).toContain('"${REACT_NATIVE_DIR}/ReactCommon"')
  })

  test('is a stable fixpoint: patch(patch(x)) === patch(x)', () => {
    const once = patchCommonCmakeText(PRISTINE_COMMON_CMAKE).contents
    const twice = patchCommonCmakeText(once)
    expect(twice.changed).toBe(false)
    expect(twice.status).toBe('already')
    expect(twice.contents).toBe(once)
  })

  test('inserted block is valid CMake: every "(" has a matching ")"', () => {
    const { contents } = patchCommonCmakeText(PRISTINE_COMMON_CMAKE)
    const block = contents.slice(contents.indexOf(MARKER) - 2)
    let depth = 0
    for (const ch of block) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })

  test('anchor-missing content is left untouched with status anchor-missing', () => {
    const alien = 'add_library(EXPO_COMMON INTERFACE)\n# totally reshaped upstream\n'
    const { contents, changed, status } = patchCommonCmakeText(alien)
    expect(changed).toBe(false)
    expect(status).toBe('anchor-missing')
    expect(contents).toBe(alien)
  })

  test('handles CRLF files (inserts CRLF block)', () => {
    const crlf = PRISTINE_COMMON_CMAKE.split('\n').join('\r\n')
    const { contents, changed } = patchCommonCmakeText(crlf)
    expect(changed).toBe(true)
    expect(contents).toContain(`"${'${REACT_NATIVE_DIR}'}/ReactCommon"`)
    expect(contents.split('\r\n').length).toBeGreaterThan(crlf.split('\r\n').length)
    expect(contents.includes('\n\n')).toBe(false) // no bare-LF pollution
  })
})

describe('patchExpoReactCommonInclude (fs walker)', () => {
  test('patches the hoisted root node_modules layout', () => {
    const { mobileRoot, commonCmake } = makeNodeModules({ hoisted: true })
    const result = patchExpoReactCommonInclude(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(1)
    expect(fs.readFileSync(commonCmake, 'utf8')).toContain(MARKER)
  })

  test('patches the nested mobile/node_modules layout', () => {
    const { mobileRoot, commonCmake } = makeNodeModules({ hoisted: false })
    const result = patchExpoReactCommonInclude(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(1)
    expect(fs.readFileSync(commonCmake, 'utf8')).toContain(MARKER)
  })

  test('already-patched tree is a clean no-op', () => {
    const { mobileRoot, commonCmake } = makeNodeModules({ hoisted: true, alreadyPatched: true })
    const before = fs.readFileSync(commonCmake, 'utf8')
    const result = patchExpoReactCommonInclude(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(0)
    expect(result.alreadyOk).toBe(1)
    expect(fs.readFileSync(commonCmake, 'utf8')).toBe(before)
  })

  test('no node_modules at all is a clean skip', () => {
    const result = patchExpoReactCommonInclude(tmp)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(0)
  })
})

describe('breakageStillPresent (drift detection)', () => {
  test('detects the still-broken upstream shape', () => {
    const { nm } = makeNodeModules({ hoisted: true })
    expect(breakageStillPresent(nm)).toBe(true)
  })

  test('upstream fixing EventEmitter.cpp makes it false', () => {
    const { nm } = makeNodeModules({ hoisted: true })
    const ee = path.join(nm, 'expo-modules-core', 'common', 'cpp', 'EventEmitter.cpp')
    fs.writeFileSync(ee, '#include <jserrorhandler/ErrorUtils.h>\n')
    expect(breakageStillPresent(nm)).toBe(false)
  })
})
