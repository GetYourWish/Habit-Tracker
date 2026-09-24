// embed-icon-font plugin — the 2026-09-22 "blank spaces instead of icons"
// fix. The MaterialCommunityIcons TTF must land in the generated Android
// project's assets/fonts/ under the icon FAMILY name so ReactFontManager's
// createAssetTypeface fallback can load it directly from APK assets (the
// runtime metro-asset path is the fragile chain that failed on device).
//
// This suite pins:
//   1. the @expo/vector-icons 15 module shape is parsed correctly (family
//      name + TTF path, including the imported-identifier form)
//   2. the embedder copies the real TTF into android/app/src/main/assets/fonts/
//   3. it is a no-op without an android folder (fresh install — prebuild
//      covers that case) and loud when the module shape drifts
//   4. the wiring: app.json plugins + package.json postinstall both call it

const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const mobileRoot = path.join(__dirname, '..')
const {
  embedIconFont,
  parseIconModule,
  resolveFontFile,
  ANDROID_ASSETS_FONTS,
  MIN_FONT_BYTES
} = require('../plugins/embed-icon-font')

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-font-test-'))
}

const VECTOR_ICONS_SHAPE = `import createIconSet from './createIconSet';
import font from './vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf';
import glyphMap from './vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
export default createIconSet(glyphMap, 'material-community', font);
`

const LITERAL_SHAPE = `import createIconSet from './createIconSet';
import glyphMap from './vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
export default createIconSet(glyphMap, 'material-community', './vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf');
`

describe('parseIconModule (@expo/vector-icons 15 shapes)', () => {
  test('resolves the imported-identifier font path (installed shape)', () => {
    const parsed = parseIconModule(VECTOR_ICONS_SHAPE)
    expect(parsed).not.toBeNull()
    expect(parsed.fontName).toBe('material-community')
    expect(parsed.fontSpecifier).toBe('./vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf')
  })

  test('resolves the string-literal font path (older/alternate shape)', () => {
    const parsed = parseIconModule(LITERAL_SHAPE)
    expect(parsed).not.toBeNull()
    expect(parsed.fontName).toBe('material-community')
    expect(parsed.fontSpecifier).toBe('./vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf')
  })

  test('returns null when the createIconSet call no longer matches (never guess a family name)', () => {
    expect(parseIconModule('export default {};')).toBeNull()
  })

  test('resolves the font specifier against the module directory', () => {
    const fontFile = resolveFontFile(
      '/repo/node_modules/@expo/vector-icons/build/MaterialCommunityIcons.js',
      './vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'
    )
    expect(fontFile).toBe(
      path.normalize('/repo/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf')
    )
  })
})

describe('embedIconFont against the REAL installed package', () => {
  test('parses the actual node_modules module and finds a real TTF >= the size floor', () => {
    const iconModuleFile = path.join(
      mobileRoot,
      '..',
      'node_modules',
      '@expo/vector-icons',
      'build',
      'MaterialCommunityIcons.js'
    )
    expect(fs.existsSync(iconModuleFile)).toBe(true)
    const parsed = parseIconModule(fs.readFileSync(iconModuleFile, 'utf8'))
    expect(parsed).not.toBeNull()
    expect(parsed.fontName).toBe('material-community')

    const fontFile = resolveFontFile(iconModuleFile, parsed.fontSpecifier)
    expect(fs.existsSync(fontFile)).toBe(true)
    expect(fs.statSync(fontFile).size).toBeGreaterThanOrEqual(MIN_FONT_BYTES)
  })
})

describe('embedIconFont filesystem behavior', () => {
  let tmp
  beforeEach(() => {
    tmp = makeTmpDir()
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function fakePackage(root, ttfBytes = Buffer.alloc(MIN_FONT_BYTES + 500, 7)) {
    const pkg = path.join(root, 'node_modules', '@expo', 'vector-icons')
    fs.mkdirSync(path.join(pkg, 'build', 'vendor', 'react-native-vector-icons', 'Fonts'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'build', 'MaterialCommunityIcons.js'), VECTOR_ICONS_SHAPE)
    fs.writeFileSync(
      path.join(pkg, 'build', 'vendor', 'react-native-vector-icons', 'Fonts', 'MaterialCommunityIcons.ttf'),
      ttfBytes
    )
    return pkg
  }

  test('copies the TTF into android/app/src/main/assets/fonts/<family>.ttf when a prebuild folder exists', () => {
    fakePackage(tmp)
    fs.mkdirSync(path.join(tmp, 'android', 'app', 'src', 'main'), { recursive: true })
    const result = embedIconFont(tmp, () => {})
    expect(result.ok).toBe(true)
    expect(result.fontName).toBe('material-community')
    const target = path.join(tmp, ANDROID_ASSETS_FONTS, 'material-community.ttf')
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).size).toBeGreaterThanOrEqual(MIN_FONT_BYTES)
  })

  test('is idempotent (second run changes nothing)', () => {
    fakePackage(tmp)
    fs.mkdirSync(path.join(tmp, 'android', 'app', 'src', 'main'), { recursive: true })
    embedIconFont(tmp, () => {})
    const target = path.join(tmp, ANDROID_ASSETS_FONTS, 'material-community.ttf')
    const first = fs.statSync(target)
    const result = embedIconFont(tmp, () => {})
    expect(result.ok).toBe(true)
    expect(fs.statSync(target).mtimeMs).toBe(first.mtimeMs)
  })

  test('skips without an android folder (fresh install; prebuild embeds later)', () => {
    fakePackage(tmp)
    const result = embedIconFont(tmp, () => {})
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-android-folder')
  })

  test('refuses to embed a suspiciously small TTF', () => {
    fakePackage(tmp, Buffer.alloc(100, 7))
    fs.mkdirSync(path.join(tmp, 'android', 'app', 'src', 'main'), { recursive: true })
    const result = embedIconFont(tmp, () => {})
    expect(result.ok).toBe(false)
  })

  test('never throws when the package is missing (npm install must survive)', () => {
    const result = embedIconFont(tmp, () => {})
    expect(result.ok).toBe(false)
  })
})

describe('wiring', () => {
  test('app.json registers the prebuild plugin', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
    expect(appJson.expo.plugins).toContain('./plugins/with-icon-font')
  })

  test('package.json postinstall repairs stale prebuild folders', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts.postinstall).toContain('node plugins/embed-icon-font.js')
  })

  test('the with-icon-font config plugin loads and exports a function', () => {
    const plugin = require('../plugins/with-icon-font')
    expect(typeof plugin).toBe('function')
  })

  test('the embedder runs clean as a CLI (no crash, exit 0)', () => {
    const r = cp.spawnSync(process.execPath, [path.join(mobileRoot, 'plugins', 'embed-icon-font.js')], {
      encoding: 'utf8',
      cwd: mobileRoot
    })
    expect(r.status).toBe(0)
  })

  test('the generated android folder (when present) carries the font', () => {
    const target = path.join(mobileRoot, 'android', 'app', 'src', 'main', 'assets', 'fonts', 'material-community.ttf')
    if (!fs.existsSync(path.join(mobileRoot, 'android'))) return // prebuild not run in this checkout
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).size).toBeGreaterThanOrEqual(MIN_FONT_BYTES)
  })
})
