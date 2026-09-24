// Unit tests for mobile/plugins/patch-windows-cmake.js
//
// Windows C++ build failures this patcher covers:
//   1. "ninja: error: manifest 'build.ninja' still dirty after 100 tries"
//      — file(GLOB_RECURSE … CONFIGURE_DEPENDS)
//   2. "ninja: error: mkdir(CMakeFiles/worklets.dir/C_/Users/…/Common)"
//      — absolute glob → C_/Users object dirs past MAX_PATH
//   3. "ninja: error: mkdir(safeareacontext_autolinked_build/…/C_/Users/…)"
//      — same encoding, but in the APP cmake (New Arch codegen), not the
//        worklets library cmake.
// Transforms are pure string work against excerpts of the real npm files.

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  patchCMakeListsText,
  patchGradleKtsText,
  patchAppBuildGradleText,
  patchAppSetupCMakeText,
  patchWindowsCmake,
  CMAKE_SUPPRESS,
  CMAKE_OBJMAX,
  CMAKE_OBJMAX_VALUE,
  CMAKE_OBJMAX_SET,
  MARKER,
  REL_MARKER,
  SHORT_MARKER,
  NATIVE_LIBS,
  APP_CMAKE_REL
} = require('../plugins/patch-windows-cmake')

const REANIMATED_CMAKELISTS = `project(Reanimated)
cmake_minimum_required(VERSION 3.16)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

file(GLOB_RECURSE REANIMATED_COMMON_CPP_SOURCES CONFIGURE_DEPENDS
     "\${COMMON_CPP_DIR}/reanimated/*.cpp")
file(GLOB_RECURSE REANIMATED_ANDROID_CPP_SOURCES CONFIGURE_DEPENDS
     "\${ANDROID_CPP_DIR}/reanimated/*.cpp")
file(GLOB_RECURSE REANIMATED_NATIVEVIEW_CPP_SOURCES CONFIGURE_DEPENDS
     "\${NATIVEVIEW_DIR}/react/renderer/components/rnreanimated/*.cpp")

add_library(reanimated SHARED \${REANIMATED_COMMON_CPP_SOURCES})
`

const WORKLETS_CMAKELISTS = `cmake_minimum_required(VERSION 3.16)
project(Worklets)

file(GLOB_RECURSE WORKLETS_COMMON_CPP_SOURCES CONFIGURE_DEPENDS
     "\${COMMON_CPP_DIR}/worklets/*.cpp")
file(GLOB_RECURSE WORKLETS_ANDROID_CPP_SOURCES CONFIGURE_DEPENDS
     "\${ANDROID_CPP_DIR}/worklets/*.cpp")

add_library(worklets SHARED \${WORKLETS_COMMON_CPP_SOURCES})
`

const SAFEAREA_CMAKELISTS = `cmake_minimum_required(VERSION 3.13)
set(LIB_LITERAL safeareacontext)
set(LIB_TARGET_NAME react_codegen_\${LIB_LITERAL})
set(LIB_ANDROID_DIR \${CMAKE_CURRENT_SOURCE_DIR}/../../..)
set(LIB_COMMON_DIR \${LIB_ANDROID_DIR}/../common/cpp)

file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS *.cpp \${LIB_COMMON_DIR}/react/renderer/components/\${LIB_LITERAL}/*.cpp)
file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS \${LIB_ANDROID_GENERATED_JNI_DIR}/*.cpp)

add_library(
  \${LIB_TARGET_NAME}
  SHARED
  \${LIB_CUSTOM_SRCS}
  \${LIB_CODEGEN_SRCS}
)
`

const APP_CMAKE = `cmake_minimum_required(VERSION 3.13)

# Define the library name here.
project(appmodules)

include(\${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
`

const REANIMATED_KTS = `        @Suppress("UnstableApiUsage")
        externalNativeBuild {
            cmake {
                arguments(
                    "-DANDROID_STL=c++_shared",
                    "-DANDROID_TOOLCHAIN=clang",
                    "-DREACT_NATIVE_DIR=\${toPlatformFileString(reactNativeRootDir.path)}",
                    "-DREANIMATED_VERSION=$REANIMATED_VERSION"
                )
                targets("reanimated")
            }
        }
`

const APP_BUILD_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdk rootProject.ext.compileSdkVersion
    namespace 'com.getyourwish.performancetracker'
    defaultConfig {
        applicationId 'com.getyourwish.performancetracker'
        versionCode 3
        versionName "1.0.2"
    }
}
`

function expectedPatchedCount() {
  let n = 1 // default-app-setup
  for (const lib of NATIVE_LIBS) {
    n += 1
    if (lib.gradleRel) n += 1
  }
  return n
}

describe('patchCMakeListsText', () => {
  test('strips CONFIGURE_DEPENDS, prepends the header before project(), relativizes sources (reanimated shape)', () => {
    const { contents, changed } = patchCMakeListsText(REANIMATED_CMAKELISTS)
    expect(changed).toBe(true)
    expect(contents).not.toMatch(/file\s*\(\s*GLOB[_A-Z]*\s+\S+\s+CONFIGURE_DEPENDS/)
    expect(contents).toContain('file(GLOB_RECURSE REANIMATED_COMMON_CPP_SOURCES')
    expect(contents).toContain('${COMMON_CPP_DIR}/reanimated/*.cpp')
    expect(contents).toContain('set(CMAKE_SUPPRESS_REGENERATION ON)')
    expect(contents).toContain(CMAKE_OBJMAX_SET)
    expect(contents).toContain(MARKER)
    expect(contents).toContain(REL_MARKER)
    expect(contents).toContain('get_cmake_property(_pt_vars VARIABLES)')
    expect(contents).toContain('file(RELATIVE_PATH _pt_src')
    const objmaxAt = contents.indexOf('set(CMAKE_OBJECT_PATH_MAX')
    const projAt = contents.search(/^project\s*\(/m)
    const relAt = contents.indexOf(REL_MARKER)
    const globAt = contents.indexOf('file(GLOB_RECURSE')
    const addAt = contents.indexOf('add_library(')
    expect(objmaxAt).toBeGreaterThanOrEqual(0)
    expect(projAt).toBeGreaterThan(objmaxAt)
    expect(relAt).toBeGreaterThan(globAt)
    expect(addAt).toBeGreaterThan(relAt)
  })

  test('handles cmake_minimum_required appearing before project() (worklets shape)', () => {
    const { contents, changed } = patchCMakeListsText(WORKLETS_CMAKELISTS)
    expect(changed).toBe(true)
    expect(contents).not.toMatch(/file\s*\(\s*GLOB[_A-Z]*\s+\S+\s+CONFIGURE_DEPENDS/)
    expect(contents).toContain('file(GLOB_RECURSE WORKLETS_COMMON_CPP_SOURCES')
    expect(contents).toContain(CMAKE_OBJMAX_SET)
    expect(contents).toContain(REL_MARKER)
    expect(contents.indexOf('set(CMAKE_OBJECT_PATH_MAX')).toBeLessThan(contents.search(/^project\s*\(/m))
  })

  test('relativizes LIB_CUSTOM_SRCS in the safe-area-context jni CMakeLists', () => {
    const { contents, changed } = patchCMakeListsText(SAFEAREA_CMAKELISTS)
    expect(changed).toBe(true)
    expect(contents).not.toMatch(/file\s*\(\s*GLOB[_A-Z]*\s+\S+\s+CONFIGURE_DEPENDS/)
    expect(contents).toContain('file(GLOB LIB_CUSTOM_SRCS')
    expect(contents).toContain(REL_MARKER)
    expect(contents).toContain('_SRCS|_SOURCES')
    expect(contents.indexOf(REL_MARKER)).toBeLessThan(contents.indexOf('add_library('))
    expect(contents).toContain(CMAKE_OBJMAX_SET)
  })

  test('prepends OBJECT_PATH_MAX before project(appmodules) in the RN default app cmake', () => {
    const { contents, changed } = patchCMakeListsText(APP_CMAKE)
    expect(changed).toBe(true)
    expect(contents).toContain(CMAKE_OBJMAX_SET)
    expect(contents.indexOf('set(CMAKE_OBJECT_PATH_MAX')).toBeLessThan(contents.search(/^project\s*\(/m))
    // no add_library in this file — no relsrc block
    expect(contents).not.toContain(REL_MARKER)
  })

  test('injects short-object stubs after ReactNative-application.cmake (app setup)', () => {
    const { contents, changed } = patchAppSetupCMakeText(APP_CMAKE)
    expect(changed).toBe(true)
    expect(contents).toContain(CMAKE_OBJMAX_SET)
    expect(contents).toContain(SHORT_MARKER)
    expect(contents).toContain('pt_win_short_objects()')
    expect(contents).toContain('file(WRITE')
    expect(contents).toContain('#include')
    const includeAt = contents.indexOf('ReactNative-application.cmake')
    const stubAt = contents.indexOf(SHORT_MARKER)
    expect(includeAt).toBeGreaterThanOrEqual(0)
    expect(stubAt).toBeGreaterThan(includeAt)
    expect(contents).not.toContain(REL_MARKER)
  })

  test('short-object pass is gated on the build HOST, never on the target WIN32', () => {
    // WIN32 describes the TARGET platform and is false for every Android
    // build — gating on it made the pass dead code and the Windows
    // safeareacontext mkdir failure kept happening. The host check is
    // CMAKE_HOST_WIN32; PT_WIN_SHORT_OBJECTS_FORCE allows CI parity runs.
    const { contents } = patchAppSetupCMakeText(APP_CMAKE)
    expect(contents).toContain('if(NOT CMAKE_HOST_WIN32 AND NOT PT_WIN_SHORT_OBJECTS_FORCE)')
    expect(contents).not.toMatch(/if\(NOT WIN32\)/)
  })

  test('only compilable target types are stubbed (custom/utility targets keep their sources)', () => {
    const { contents } = patchAppSetupCMakeText(APP_CMAKE)
    expect(contents).toContain(
      '_type MATCHES "^(SHARED_LIBRARY|MODULE_LIBRARY|STATIC_LIBRARY|OBJECT_LIBRARY|EXECUTABLE)$"'
    )
    // The old INTERFACE_LIBRARY-only check no longer exists (subsumed).
    expect(contents).not.toContain('STREQUAL "INTERFACE_LIBRARY"')
  })

  test('re-running the patcher upgrades an older WIN32-gated block in place', () => {
    // node_modules survives `git pull`, so the user's disk holds the block
    // written by the PREVIOUS (buggy) plugin version. The patcher must
    // strip + re-inject so the fixed block replaces it without a reinstall.
    const fresh = patchAppSetupCMakeText(APP_CMAKE).contents
    const stale = fresh.replace(
      /function\(pt_win_short_objects\)[\s\S]*?endfunction\(\)/,
      [
        'function(pt_win_short_objects)',
        '  if(NOT WIN32)',
        '    return()',
        '  endif()',
        '  pt_win_walk_targets(_pt_all "${CMAKE_SOURCE_DIR}")',
        '  foreach(_pt_tgt IN LISTS _pt_all)',
        '    pt_win_stub_target("${_pt_tgt}")',
        '  endforeach()',
        'endfunction()'
      ].join('\n')
    )
    expect(stale).toContain('if(NOT WIN32)') // sanity: this is the old shape
    const migrated = patchAppSetupCMakeText(stale)
    expect(migrated.changed).toBe(true)
    expect(migrated.contents).toContain('if(NOT CMAKE_HOST_WIN32 AND NOT PT_WIN_SHORT_OBJECTS_FORCE)')
    expect(migrated.contents).not.toMatch(/if\(NOT WIN32\)/)
    expect(migrated.contents.split(SHORT_MARKER).length - 1).toBe(1)
    // The upgraded file is byte-identical to a fresh patch.
    expect(migrated.contents).toBe(fresh)
  })

  test('app-setup patch is idempotent', () => {
    const once = patchAppSetupCMakeText(APP_CMAKE).contents
    const twice = patchAppSetupCMakeText(once)
    expect(twice.changed).toBe(false)
    expect(twice.contents).toBe(once)
    expect(twice.contents.split(SHORT_MARKER).length - 1).toBe(1)
    expect(twice.contents.split('set(CMAKE_OBJECT_PATH_MAX').length - 1).toBe(1)
  })

  test('is idempotent', () => {
    const once = patchCMakeListsText(REANIMATED_CMAKELISTS).contents
    const twice = patchCMakeListsText(once)
    expect(twice.changed).toBe(false)
    expect(twice.contents).toBe(once)
    expect(twice.contents.split('set(CMAKE_SUPPRESS_REGENERATION').length - 1).toBe(1)
    expect(twice.contents.split('set(CMAKE_OBJECT_PATH_MAX').length - 1).toBe(1)
    expect(twice.contents.split(REL_MARKER).length - 1).toBe(1)
  })

  test('migrates a previously-injected CMAKE_OBJECT_PATH_MAX 1024/128 header to 250 + relsrc', () => {
    const with128 = `# ${MARKER}
set(CMAKE_SUPPRESS_REGENERATION ON)
set(CMAKE_OBJECT_PATH_MAX 128)
# <<< with-windows-cmake

` + REANIMATED_CMAKELISTS.replace(/ CONFIGURE_DEPENDS/g, '')
    expect(with128).toContain('set(CMAKE_OBJECT_PATH_MAX 128)')
    const migrated = patchCMakeListsText(with128)
    expect(migrated.changed).toBe(true)
    expect(migrated.contents).toContain(CMAKE_OBJMAX_SET)
    expect(migrated.contents).not.toContain('set(CMAKE_OBJECT_PATH_MAX 128)')
    expect(migrated.contents.split('set(CMAKE_OBJECT_PATH_MAX').length - 1).toBe(1)
    expect(migrated.contents).toContain(REL_MARKER)
    expect(migrated.contents.indexOf('set(CMAKE_OBJECT_PATH_MAX')).toBeLessThan(
      migrated.contents.search(/^project\s*\(/m)
    )
  })

  test('rewrites an old hardcoded relsrc foreach into the generic VARIABLES scan', () => {
    const oldRelsrc = patchCMakeListsText(REANIMATED_CMAKELISTS).contents.replace(
      /get_cmake_property\(_pt_vars VARIABLES\)[\s\S]*?endforeach\(\)/,
      'foreach(_pt_var IN ITEMS WORKLETS_COMMON_CPP_SOURCES)\n  set(_pt_rel "")\nendforeach()'
    )
    expect(oldRelsrc).toContain('foreach(_pt_var IN ITEMS WORKLETS_COMMON_CPP_SOURCES)')
    const migrated = patchCMakeListsText(oldRelsrc)
    expect(migrated.changed).toBe(true)
    expect(migrated.contents).toContain('get_cmake_property(_pt_vars VARIABLES)')
    expect(migrated.contents.split(REL_MARKER).length - 1).toBe(1)
  })

  test('preserves CRLF when the input is a Windows checkout', () => {
    const crlf = REANIMATED_CMAKELISTS.replace(/\n/g, '\r\n')
    const { contents } = patchCMakeListsText(crlf)
    expect(contents).toContain('\r\n')
    expect(contents).toContain('set(CMAKE_SUPPRESS_REGENERATION ON)\r\n')
    expect(contents.includes('ON\nset(CMAKE_OBJECT')).toBe(false)
  })
})

describe('patchGradleKtsText', () => {
  test('injects both -D flags ahead of the existing ANDROID_STL argument', () => {
    const { contents, changed, missing } = patchGradleKtsText(REANIMATED_KTS)
    expect(missing).toBe(false)
    expect(changed).toBe(true)
    expect(contents).toContain(CMAKE_SUPPRESS)
    expect(contents).toContain(CMAKE_OBJMAX)
    expect(CMAKE_OBJMAX_VALUE).toBe('250')
    const suppressAt = contents.indexOf(CMAKE_SUPPRESS)
    const stlAt = contents.indexOf('-DANDROID_STL=c++_shared')
    expect(suppressAt).toBeGreaterThanOrEqual(0)
    expect(stlAt).toBeGreaterThan(suppressAt)
    expect(contents).toContain(`"${CMAKE_SUPPRESS}",`)
    expect(contents).toContain(`"${CMAKE_OBJMAX}",`)
  })

  test('is idempotent', () => {
    const once = patchGradleKtsText(REANIMATED_KTS).contents
    const twice = patchGradleKtsText(once)
    expect(twice.changed).toBe(false)
    expect(twice.contents).toBe(once)
    expect(twice.contents.split(CMAKE_SUPPRESS).length - 1).toBe(1)
    expect(twice.contents.split('CMAKE_OBJECT_PATH_MAX').length - 1).toBe(1)
  })

  test('migrates a previously-injected -DCMAKE_OBJECT_PATH_MAX=1024 or 128 without duplicating flags', () => {
    for (const oldVal of ['1024', '128']) {
      const old = patchGradleKtsText(REANIMATED_KTS).contents.replace(
        `-DCMAKE_OBJECT_PATH_MAX=${CMAKE_OBJMAX_VALUE}`,
        `-DCMAKE_OBJECT_PATH_MAX=${oldVal}`
      )
      expect(old).toContain(`-DCMAKE_OBJECT_PATH_MAX=${oldVal}`)
      const migrated = patchGradleKtsText(old)
      expect(migrated.changed).toBe(true)
      expect(migrated.missing).toBe(false)
      expect(migrated.contents).toContain(CMAKE_OBJMAX)
      expect(migrated.contents).not.toContain(`CMAKE_OBJECT_PATH_MAX=${oldVal}`)
      expect(migrated.contents.split(CMAKE_SUPPRESS).length - 1).toBe(1)
      expect(migrated.contents.split('CMAKE_OBJECT_PATH_MAX').length - 1).toBe(1)
    }
  })

  test('reports missing when there is no cmake ANDROID_STL argument to anchor on', () => {
    const { missing, changed, contents } = patchGradleKtsText('plugins { id("com.android.library") }\n')
    expect(missing).toBe(true)
    expect(changed).toBe(false)
    expect(contents).toBe('plugins { id("com.android.library") }\n')
  })
})

describe('patchAppBuildGradleText', () => {
  test('injects cmake arguments into the android { } block', () => {
    const { contents, changed, missing } = patchAppBuildGradleText(APP_BUILD_GRADLE)
    expect(missing).toBe(false)
    expect(changed).toBe(true)
    expect(contents).toContain(`arguments "${CMAKE_OBJMAX}", "${CMAKE_SUPPRESS}"`)
    expect(contents).toContain(MARKER)
    expect(contents.indexOf('android {')).toBeLessThan(contents.indexOf(CMAKE_OBJMAX))
  })

  test('is idempotent', () => {
    const once = patchAppBuildGradleText(APP_BUILD_GRADLE).contents
    const twice = patchAppBuildGradleText(once)
    expect(twice.changed).toBe(false)
    expect(twice.contents).toBe(once)
    expect(twice.contents.split(CMAKE_OBJMAX).length - 1).toBe(1)
  })

  test('reports missing when there is no android { } block', () => {
    const { missing, changed } = patchAppBuildGradleText('plugins { id("com.android.application") }\n')
    expect(missing).toBe(true)
    expect(changed).toBe(false)
  })
})

describe('patchWindowsCmake filesystem walk', () => {
  let tmp
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-cmake-test-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function seedLayout({ hoisted, withAppGradle }) {
    const mobileRoot = path.join(tmp, 'mobile')
    const nm = hoisted ? path.join(tmp, 'node_modules') : path.join(mobileRoot, 'node_modules')
    fs.mkdirSync(mobileRoot, { recursive: true })
    for (const lib of NATIVE_LIBS) {
      // every real node_modules package has a package.json — v1.0.7 made its
      // presence the "this lib is actually installed" signal (reanimated and
      // worklets are intentionally gone from the app now, and their absence
      // must be a clean skip, not drift)
      fs.mkdirSync(path.join(nm, lib.name), { recursive: true })
      fs.writeFileSync(path.join(nm, lib.name, 'package.json'), JSON.stringify({ name: lib.name }))
      const cmakeFile = path.join(nm, lib.name, lib.cmakeRel)
      fs.mkdirSync(path.dirname(cmakeFile), { recursive: true })
      fs.writeFileSync(cmakeFile, lib.name.includes('safe-area') ? SAFEAREA_CMAKELISTS : REANIMATED_CMAKELISTS)
      if (lib.gradleRel) {
        const ktsFile = path.join(nm, lib.name, lib.gradleRel)
        fs.mkdirSync(path.dirname(ktsFile), { recursive: true })
        fs.writeFileSync(ktsFile, REANIMATED_KTS)
      }
    }
    const appCmake = path.join(nm, APP_CMAKE_REL)
    fs.mkdirSync(path.dirname(appCmake), { recursive: true })
    fs.writeFileSync(appCmake, APP_CMAKE)
    if (withAppGradle) {
      const gradle = path.join(mobileRoot, 'android', 'app', 'build.gradle')
      fs.mkdirSync(path.dirname(gradle), { recursive: true })
      fs.writeFileSync(gradle, APP_BUILD_GRADLE)
    }
    return { mobileRoot, nm }
  }

  test('patches CMakeLists + gradle.kts for libraries + the RN app cmake (nested node_modules)', () => {
    const { mobileRoot, nm } = seedLayout({ hoisted: false })
    const result = patchWindowsCmake(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(expectedPatchedCount())
    expect(result.missing).toEqual([])
    for (const lib of NATIVE_LIBS) {
      const cmake = fs.readFileSync(path.join(nm, lib.name, lib.cmakeRel), 'utf8')
      expect(cmake).not.toMatch(/file\s*\(\s*GLOB[_A-Z]*\s+\S+\s+CONFIGURE_DEPENDS/)
      expect(cmake).toContain('CMAKE_SUPPRESS_REGENERATION')
      expect(cmake).toContain(CMAKE_OBJMAX_SET)
      if (lib.gradleRel) {
        const kts = fs.readFileSync(path.join(nm, lib.name, lib.gradleRel), 'utf8')
        expect(kts).toContain(CMAKE_SUPPRESS)
        expect(kts).toContain(CMAKE_OBJMAX)
      }
    }
    const appCmake = fs.readFileSync(path.join(nm, APP_CMAKE_REL), 'utf8')
    expect(appCmake).toContain(CMAKE_OBJMAX_SET)
    expect(appCmake).toContain(SHORT_MARKER)
    expect(appCmake.indexOf('set(CMAKE_OBJECT_PATH_MAX')).toBeLessThan(appCmake.search(/^project\s*\(/m))
  })

  test('also injects cmake arguments into android/app/build.gradle when it exists', () => {
    const { mobileRoot } = seedLayout({ hoisted: false, withAppGradle: true })
    const result = patchWindowsCmake(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(expectedPatchedCount() + 1)
    const gradle = fs.readFileSync(path.join(mobileRoot, 'android', 'app', 'build.gradle'), 'utf8')
    expect(gradle).toContain(CMAKE_OBJMAX)
    expect(gradle).toContain(CMAKE_SUPPRESS)
  })

  test('finds libraries when npm hoisted them to the repo root', () => {
    const { mobileRoot } = seedLayout({ hoisted: true })
    const result = patchWindowsCmake(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.patched).toBe(expectedPatchedCount())
  })

  test('v1.0.7: a lib that is not installed at all is a CLEAN skip, not drift', () => {
    // reanimated + worklets were removed from the app; their absence must
    // not fail the postinstall (the v1.0.6 patcher exited 1 and broke
    // `npm install` the moment the packages were gone)
    const { mobileRoot, nm } = seedLayout({ hoisted: false })
    fs.rmSync(path.join(nm, 'react-native-reanimated'), { recursive: true, force: true })
    fs.rmSync(path.join(nm, 'react-native-worklets'), { recursive: true, force: true })
    const result = patchWindowsCmake(mobileRoot)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    // only safe-area-context + the RN app cmake remain to patch
    expect(result.patched).toBe(2)
  })

  test('second run is a no-op (alreadyOk, no extra writes)', () => {
    const { mobileRoot, nm } = seedLayout({ hoisted: false })
    patchWindowsCmake(mobileRoot)
    const cmakePath = path.join(nm, 'react-native-reanimated', 'android', 'CMakeLists.txt')
    const before = fs.readFileSync(cmakePath, 'utf8')
    const second = patchWindowsCmake(mobileRoot)
    expect(second.patched).toBe(0)
    expect(second.alreadyOk).toBe(expectedPatchedCount())
    expect(second.ok).toBe(true)
    expect(fs.readFileSync(cmakePath, 'utf8')).toBe(before)
  })

  test('migrates on-disk 128 patches without a second insert', () => {
    const { mobileRoot, nm } = seedLayout({ hoisted: false })
    patchWindowsCmake(mobileRoot)
    for (const lib of NATIVE_LIBS) {
      const cmakeFile = path.join(nm, lib.name, lib.cmakeRel)
      fs.writeFileSync(
        cmakeFile,
        fs.readFileSync(cmakeFile, 'utf8').replace(CMAKE_OBJMAX_SET, 'set(CMAKE_OBJECT_PATH_MAX 128)')
      )
      if (lib.gradleRel) {
        const ktsFile = path.join(nm, lib.name, lib.gradleRel)
        fs.writeFileSync(
          ktsFile,
          fs.readFileSync(ktsFile, 'utf8').replace(
            `-DCMAKE_OBJECT_PATH_MAX=${CMAKE_OBJMAX_VALUE}`,
            '-DCMAKE_OBJECT_PATH_MAX=128'
          )
        )
      }
    }
    const migrated = patchWindowsCmake(mobileRoot)
    expect(migrated.ok).toBe(true)
    expect(migrated.patched).toBeGreaterThan(0)
    for (const lib of NATIVE_LIBS) {
      const cmake = fs.readFileSync(path.join(nm, lib.name, lib.cmakeRel), 'utf8')
      expect(cmake).toContain(CMAKE_OBJMAX_SET)
      expect(cmake).not.toContain('set(CMAKE_OBJECT_PATH_MAX 128)')
      if (lib.gradleRel) {
        const kts = fs.readFileSync(path.join(nm, lib.name, lib.gradleRel), 'utf8')
        expect(kts).toContain(CMAKE_OBJMAX)
        expect(kts).not.toContain('CMAKE_OBJECT_PATH_MAX=128')
      }
    }
  })

  test('returns ok=false when node_modules is missing, without throwing', () => {
    const mobileRoot = path.join(tmp, 'mobile')
    fs.mkdirSync(mobileRoot, { recursive: true })
    const result = patchWindowsCmake(mobileRoot)
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('node_modules')
  })
})
