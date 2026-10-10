const fs = require('fs')
const path = require('path')

const mobileRoot = path.join(__dirname, '..')
const repoRoot = path.join(mobileRoot, '..')

describe('Android APK build command', () => {
  test('APK build generates native Android output before invoking Gradle', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    const script = fs.readFileSync(path.join(mobileRoot, 'scripts', 'build-android-apk.js'), 'utf8')

    expect(pkg.scripts['build:apk']).toBe('node scripts/build-android-apk.js')
    expect(script).toContain("['scripts/expo-prebuild-safe.js']")
    expect(script).toContain("['assembleRelease']")
    expect(script).toContain("'app-release.apk'")
  })

  test('APK build names the finished file cleanly - no DEBUG anywhere (2026-10-10)', () => {
    const { readAppVersion, copyFriendlyApk } = require('../scripts/build-android-apk')

    // version comes straight from app.json (single source of truth)
    const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
    expect(readAppVersion()).toBe(appJson.expo.version)

    // the friendly name has no "debug" in it at all
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'apk-name-'))
    try {
      const fakeApk = path.join(tmp, 'app-release.apk')
      fs.writeFileSync(fakeApk, 'not-a-real-apk')
      const dest = copyFriendlyApk(fakeApk, tmp, '9.9.9')
      expect(dest).toBe(path.join(tmp, 'HabitTracker-v9.9.9.apk'))
      expect(path.basename(dest)).not.toMatch(/debug/i)
      expect(fs.existsSync(dest)).toBe(true)

      // a failed copy warns but never throws (the Gradle output still exists)
      const missing = path.join(tmp, 'nope.apk')
      expect(copyFriendlyApk(missing, tmp, '9.9.9')).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('root-level commands forward Android prebuild and APK builds to mobile', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['android:prebuild']).toBe('npm run prebuild --workspace @habit-tracker/mobile')
    expect(pkg.scripts['android:apk']).toBe('npm run build:apk --workspace @habit-tracker/mobile')
  })
})
