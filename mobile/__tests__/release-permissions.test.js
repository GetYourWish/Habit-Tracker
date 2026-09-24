// Unit tests for mobile/plugins/with-release-permissions.js
//
// The plugin answers the user's question "why does the app have network
// access permissions?": the Expo bare template ships a generic permission
// set that this fully-offline app never uses. The plugin writes a RELEASE
// variant manifest overlay that removes them from the merged release
// manifest while leaving debug (Metro/dev-server tooling) untouched.

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  composeReleaseManifest,
  ensureReleaseManifest,
  RELEASE_PERMISSIONS_TO_STRIP,
  TAG
} = require('../plugins/with-release-permissions')

describe('with-release-permissions plugin', () => {
  describe('composeReleaseManifest', () => {
    const manifest = composeReleaseManifest(RELEASE_PERMISSIONS_TO_STRIP)

    test('strips exactly the five unused permissions', () => {
      expect(RELEASE_PERMISSIONS_TO_STRIP).toEqual([
        'android.permission.INTERNET',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE'
      ])
    })

    test('every stripped permission uses tools:node="remove"', () => {
      for (const p of RELEASE_PERMISSIONS_TO_STRIP) {
        expect(manifest).toContain(
          '<uses-permission android:name="' + p + '" tools:node="remove"/>'
        )
      }
    })

    test('declares both namespaces the merger needs', () => {
      expect(manifest).toContain('xmlns:android="http://schemas.android.com/apk/res/android"')
      expect(manifest).toContain('xmlns:tools="http://schemas.android.com/tools"')
    })

    test('is a complete, single-root manifest document', () => {
      expect(manifest.trim().endsWith('</manifest>')).toBe(true)
      // one root element: exactly one <manifest ...> open and one close
      expect(manifest.split('<manifest').length - 1).toBe(1)
      expect(manifest.split('</manifest>').length - 1).toBe(1)
      // no stray uses-permission WITHOUT the removal directive
      const permissisonLines = manifest.split('\n').filter(l => l.includes('uses-permission'))
      for (const line of permissisonLines) {
        expect(line).toContain('tools:node="remove"')
      }
    })

    test('never removes the androidx dynamic-receiver marker permission', () => {
      // injected by androidx-core at build time; cannot (and must not) be
      // opted out of from the app side
      expect(manifest).not.toContain('DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
    })
  })

  describe('ensureReleaseManifest', () => {
    let tmpDir
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-release-perms-'))
    })
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    test('writes the overlay into app/src/release/, creating the dir', () => {
      const manifestPath = ensureReleaseManifest(tmpDir)
      expect(manifestPath).toBe(path.join(tmpDir, 'app', 'src', 'release', 'AndroidManifest.xml'))
      const contents = fs.readFileSync(manifestPath, 'utf8')
      expect(contents).toContain('android.permission.INTERNET" tools:node="remove')
      expect(contents.startsWith('<!-- ' + TAG)).toBe(true)
    })

    test('is idempotent — rewriting produces identical contents', () => {
      ensureReleaseManifest(tmpDir)
      const first = fs.readFileSync(
        path.join(tmpDir, 'app', 'src', 'release', 'AndroidManifest.xml'),
        'utf8'
      )
      ensureReleaseManifest(tmpDir)
      const second = fs.readFileSync(
        path.join(tmpDir, 'app', 'src', 'release', 'AndroidManifest.xml'),
        'utf8'
      )
      expect(second).toBe(first)
    })

    test('never touches the main or debug manifests', () => {
      const mainDir = path.join(tmpDir, 'app', 'src', 'main')
      const debugDir = path.join(tmpDir, 'app', 'src', 'debug')
      fs.mkdirSync(mainDir, { recursive: true })
      fs.mkdirSync(debugDir, { recursive: true })
      const mainManifest = path.join(mainDir, 'AndroidManifest.xml')
      const debugManifest = path.join(debugDir, 'AndroidManifest.xml')
      fs.writeFileSync(mainManifest, '<manifest>MAIN</manifest>')
      fs.writeFileSync(debugManifest, '<manifest>DEBUG</manifest>')

      ensureReleaseManifest(tmpDir)

      expect(fs.readFileSync(mainManifest, 'utf8')).toBe('<manifest>MAIN</manifest>')
      expect(fs.readFileSync(debugManifest, 'utf8')).toBe('<manifest>DEBUG</manifest>')
    })
  })
})
