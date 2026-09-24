// Unit tests for mobile/plugins/with-standalone-release.js
//
// The plugin makes the standalone-APK path foolproof:
//   1. debug buildType gets versionNameSuffix "-debug" so debug and release
//      builds are distinguishable on the device,
//   2. a verifyStandaloneApk Gradle task is appended and wired to
//      assembleRelease.finalizedBy — a release APK without the embedded
//      assets/index.android.bundle fails the build instead of showing RN's
//      "Unable to load script" red screen on the phone.
//
// The Gradle surgery is pure string work, so it is tested directly.
//
// v2 behavior (2026-09-17): debug builds ALSO embed the JS bundle
// (debuggableVariants = []) — an APK that cannot start, Metro or not, is
// never shipped again — and both assembleRelease and assembleDebug are
// followed by an APK-content verify task.

const {
  patchAppBuildGradle,
  composeVerifyBlock,
  patchDebugStringsXml,
  composeDebugAppName,
  groovyEscape,
  TAG
} = require('../plugins/with-standalone-release')

// Excerpt of the Expo SDK 57 template's android/app/build.gradle (the parts
// the plugin touches), kept close to the real thing on purpose.
const TEMPLATE_EXCERPT = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

react {
    // debuggable variants skip JS bundling (template comment, kept verbatim)
    // debuggableVariants = ["liteDebug", "prodDebug"]
    entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim())
}

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

describe('with-standalone-release plugin', () => {
  describe('patchAppBuildGradle on a fresh template', () => {
    let patched
    beforeEach(() => {
      patched = patchAppBuildGradle(TEMPLATE_EXCERPT)
    })

    test('injects versionNameSuffix into the DEBUG buildType only', () => {
      const { contents } = patched
      // exactly one suffix, inside the debug block, before the release block
      const occurrences = contents.split('versionNameSuffix "-debug"').length - 1
      expect(occurrences).toBe(1)

      const debugBlock = contents.slice(
        contents.indexOf('buildTypes {'),
        contents.indexOf('release {')
      )
      expect(debugBlock).toContain('versionNameSuffix "-debug"')
      expect(debugBlock).toContain('signingConfig signingConfigs.debug')
      // the release block itself is untouched
      const releaseBlock = contents.slice(contents.indexOf('release {'))
      expect(releaseBlock).not.toContain('versionNameSuffix')
    })

    test('appends the verifyStandaloneApk task wired to assembleRelease', () => {
      const { contents } = patched
      expect(contents).toContain('tasks.register("verifyStandaloneApk")')
      expect(contents).toMatch(
        /tasks\.matching \{ it\.name == "assembleRelease" \}\.configureEach \{ it\.finalizedBy "verifyStandaloneApk" \}/
      )
    })

    test('verify task checks the right APK entry with the right threshold', () => {
      const { contents } = patched
      expect(contents).toContain('outputs/apk/release/app-release.apk')
      expect(contents).toContain('apk.getEntry("assets/index.android.bundle")')
      expect(contents).toContain('bundleMinBytes = 1000000L')
      expect(contents).toContain('GradleException')
      expect(contents).toContain('gradlew clean assembleRelease')
    })

    test('verify task also asserts the embedded icon font (blank-icons regression)', () => {
      const { contents } = patched
      // The 2026-09-22 "blank spaces instead of icons" incident: an APK
      // without assets/fonts/*.ttf renders every icon blank. The verify
      // task must fail the build in that case.
      expect(contents).toContain('assets/fonts/')
      expect(contents).toContain('endsWith(".ttf")')
      expect(contents).toContain('NO icon font under assets/fonts/')
      expect(contents).toContain('icon font present: ')
    })

    test('is idempotent: patching an already-patched file changes nothing', () => {
      const once = patchAppBuildGradle(TEMPLATE_EXCERPT).contents
      const twice = patchAppBuildGradle(once).contents
      expect(twice).toBe(once)
      expect(twice.split('versionNameSuffix "-debug"').length - 1).toBe(1)
      expect((twice.match(/verifyStandaloneApk/g) || []).length).toBe(
        (once.match(/verifyStandaloneApk/g) || []).length
      )
    })

    test('replaces an older marker-delimited verify block so Gradle parsing is self-healed', () => {
      const broken = TEMPLATE_EXCERPT + `
${TAG} // unrelated text
// >>> with-standalone-release (mobile/plugins/with-standalone-release.js)
tasks.register("verifyStandaloneApk") {
    println "the red "Unable to load script" screen"
}
// <<< with-standalone-release
`
      const { contents } = patchAppBuildGradle(broken)
      expect(contents).toContain('red \\"Unable to load script\\"')
      expect(contents).not.toContain('red "Unable to load script" screen')
      expect(contents.match(/tasks\.register\("verifyStandaloneApk"\)/g)).toHaveLength(1)
    })

    test('injects debuggableVariants = [] into the react block so debug bundles the JS', () => {
      const { contents } = patched
      // exactly ONE active assignment, placed inside the react block
      expect(contents.match(/^\s*debuggableVariants\s*=.*$/gm)).toHaveLength(1)
      const reactBlock = contents.slice(
        contents.indexOf('react {'),
        contents.indexOf('entryFile')
      )
      expect(reactBlock).toContain('debuggableVariants = []')
      // the template's commented example must remain a comment
      expect(contents).toContain('// debuggableVariants = ["liteDebug", "prodDebug"]')
    })

    test('release banner no longer claims debug builds need Metro', () => {
      const { contents } = patched
      expect(contents).not.toContain('need Metro')
      expect(contents).toContain('prefer this app-release.apk')
    })
  })

  describe('upstream template drift (self-disabling guards)', () => {
    test('a pre-existing versionNameSuffix is never duplicated', () => {
      const modified = TEMPLATE_EXCERPT.replace(
        'debug {\n            signingConfig',
        'debug {\n            versionNameSuffix "-custom"\n            signingConfig'
      )
      const { contents } = patchAppBuildGradle(modified)
      expect(contents).toContain('versionNameSuffix "-custom"')
      expect(contents).not.toContain('versionNameSuffix "-debug"')
      // the verify block is still appended
      expect(contents).toContain('tasks.register("verifyStandaloneApk")')
    })

    test('a template without a debug block still gets the verify task, no crash', () => {
      const noDebug = TEMPLATE_EXCERPT.replace(
        /    buildTypes \{\n        debug \{\n            signingConfig signingConfigs\.debug\n        \}\n/,
        ''
      )
      const { contents } = patchAppBuildGradle(noDebug)
      expect(contents).not.toContain('versionNameSuffix')
      expect(contents).toContain('tasks.register("verifyStandaloneApk")')
    })

    test('an ACTIVE debuggableVariants assignment is never overridden', () => {
      const modified = TEMPLATE_EXCERPT.replace(
        'react {\n',
        'react {\n    debuggableVariants = ["liteDebug"]\n'
      )
      const { contents, warnings } = patchAppBuildGradle(modified)
      expect(contents.match(/^\s*debuggableVariants\s*=.*$/gm)).toHaveLength(1)
      expect(contents).toContain('debuggableVariants = ["liteDebug"]')
    })

    test('only commented-out debuggableVariants still triggers the injection', () => {
      const { contents } = patchAppBuildGradle(TEMPLATE_EXCERPT)
      expect(contents).toContain('// debuggableVariants = ["liteDebug", "prodDebug"]')
      expect(contents.match(/^\s*debuggableVariants\s*=.*$/gm)).toHaveLength(1)
    })

    test('a template without a react block warns and still appends the verify tasks', () => {
      const noReact = TEMPLATE_EXCERPT.replace(
        /react \{[\s\S]*?\}\n/,
        ''
      )
      const { contents, warnings } = patchAppBuildGradle(noReact)
      expect(warnings.some(w => w.includes('debuggableVariants NOT injected'))).toBe(true)
      expect(contents).toContain('tasks.register("verifyStandaloneApkDebug")')
    })
  })

  describe('composeVerifyBlock', () => {
    test('is marker-delimited so prebuild re-runs are no-ops', () => {
      const block = composeVerifyBlock()
      expect(block).toContain(TAG)
      expect(block.trimEnd().endsWith('// <<< with-standalone-release')).toBe(true)
      expect(block.startsWith('\n// >>> with-standalone-release')).toBe(true)
    })

    test('prints a success banner with the exact adb install command', () => {
      const block = composeVerifyBlock()
      expect(block).toContain('STANDALONE APK VERIFIED')
      expect(block).toContain('adb install -r')
      expect(block).toContain('standaloneApkFile.absolutePath')
    })

    test('covers BOTH variants with their own task, apk path and hints', () => {
      const block = composeVerifyBlock()
      expect(block).toContain('tasks.register("verifyStandaloneApk")')
      expect(block).toContain('tasks.register("verifyStandaloneApkDebug")')
      expect(block).toContain('outputs/apk/release/app-release.apk')
      expect(block).toContain('outputs/apk/debug/app-debug.apk')
      expect(block).toContain('gradlew clean assembleRelease')
      expect(block).toContain('gradlew clean assembleDebug')
      // every dynamic Groovy value is built by concatenation, never GString
      // (once per variant block: release + debug)
      expect(block.match(/entry\.getSize\(\) \+ " bytes/g) || []).toHaveLength(2)
      // the icon font check runs in BOTH variants too
      expect(block.match(/NO icon font under assets\/fonts/g) || []).toHaveLength(2)
      expect(block.match(/it\.getSize\(\) > 50000L/g) || []).toHaveLength(2)
    })

    test('escapes every quote injected into generated Groovy strings (regression: build.gradle:226 compile failure)', () => {
      const block = composeVerifyBlock()
      // The 2026-09-21 bug: the red-screen note and the debug banner carried
      // raw double quotes into Groovy "..." literals, so the generated
      // app/build.gradle failed to COMPILE — gradlew assembleRelease died
      // with '226: Unexpected input ... it would show the red "Unable'.
      // The quotes must now appear escaped, in BOTH variant blocks.
      expect(block.match(/red \\"Unable to load script\\"/g) || []).toHaveLength(2)
      expect(block).not.toContain('red "Unable')
      expect(block.match(/shows as \\"\.\.\. DEBUG\\"/g) || []).toHaveLength(1)
      expect(block).not.toContain('as "... DEBUG"')
    })

    test('groovyEscape neutralizes quotes and backslashes for Groovy literals', () => {
      expect(groovyEscape('say "hi"')).toBe('say \\"hi\\"')
      expect(groovyEscape('back\\slash')).toBe('back\\\\slash')
      expect(groovyEscape('plain text')).toBe('plain text')
    })
  })

  describe('debug launcher-name overlay (patchDebugStringsXml)', () => {
    test('fresh file: composes a minimal overlay with the DEBUG name', () => {
      const { contents, changed } = patchDebugStringsXml(null, 'Habit Tracker DEBUG')
      expect(changed).toBe(true)
      expect(contents).toContain('<string name="app_name">Habit Tracker DEBUG</string>')
      expect(contents.trim().startsWith('<resources>')).toBe(true)
    })

    test('existing overlay: replaces the old app_name value in place', () => {
      const existing = '<resources>\n  <string name="app_name">Something Else</string>\n</resources>\n'
      const { contents, changed } = patchDebugStringsXml(existing, 'Perf DEBUG')
      expect(changed).toBe(true)
      expect(contents).toContain('<string name="app_name">Perf DEBUG</string>')
      expect(contents).not.toContain('Something Else')
    })

    test('existing overlay without app_name: inserts before </resources>', () => {
      const existing = '<resources>\n  <string name="other">x</string>\n</resources>\n'
      const { contents, changed } = patchDebugStringsXml(existing, 'Perf DEBUG')
      expect(changed).toBe(true)
      expect(contents).toContain('<string name="app_name">Perf DEBUG</string>')
      expect(contents).toContain('<string name="other">x</string>')
    })

    test('idempotent: re-patching the already-patched overlay changes nothing', () => {
      const first = patchDebugStringsXml(null, 'Habit Tracker DEBUG').contents
      const second = patchDebugStringsXml(first, 'Habit Tracker DEBUG')
      expect(second.changed).toBe(false)
      expect(second.contents).toBe(first)
    })

    test('XML-escapes the app name', () => {
      const { contents } = patchDebugStringsXml(null, 'A & B <C>')
      expect(contents).toContain('A &amp; B &lt;C&gt;')
    })

    test('composeDebugAppName suffixes the main name', () => {
      expect(composeDebugAppName('Habit Tracker')).toBe('Habit Tracker DEBUG')
      expect(composeDebugAppName(undefined)).toBe('Habit Tracker DEBUG')
    })
  })
})
