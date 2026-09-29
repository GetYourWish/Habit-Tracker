// Android identity and launcher-icon contract.
//
// A reused applicationId causes Android to treat this APK as an update to a
// different app. Keep both the new, Habit Tracker-specific id and the asset
// routing explicit so a prebuild cannot silently inherit another app's config.

const fs = require('fs')
const path = require('path')

const mobileRoot = path.join(__dirname, '..')
const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
const expo = appJson.expo

function assetPath(relativePath) {
  return path.resolve(mobileRoot, relativePath)
}

describe('Android app identity', () => {
  test('uses a unique Habit Tracker application id', () => {
    expect(expo.name).toBe('Habit Tracker')
    expect(expo.android.package).toBe('com.getyourwish.habittracker')
    expect(expo.android.package).not.toMatch(/performance/i)
  })
})

describe('Android launcher icon routing', () => {
  test('routes legacy and adaptive launchers to committed PNG assets', () => {
    expect(expo.icon).toBe('./assets/icon.png')
    expect(expo.android.icon).toBe('./assets/icon.png')
    expect(expo.android.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#EEF2FF'
    })

    for (const relativePath of [
      expo.icon,
      expo.android.icon,
      expo.android.adaptiveIcon.foregroundImage
    ]) {
      const resolved = assetPath(relativePath)
      expect(fs.existsSync(resolved)).toBe(true)
      expect(fs.statSync(resolved).size).toBeGreaterThan(0)
    }
  })
})
