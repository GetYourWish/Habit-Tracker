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

  test('root-level commands forward Android prebuild and APK builds to mobile', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['android:prebuild']).toBe('npm run prebuild --workspace @habit-tracker/mobile')
    expect(pkg.scripts['android:apk']).toBe('npm run build:apk --workspace @habit-tracker/mobile')
  })
})
