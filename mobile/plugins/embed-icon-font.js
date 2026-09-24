#!/usr/bin/env node
'use strict'

/**
 * Embed the MaterialCommunityIcons TTF into the Android APK's assets/fonts/
 * directory — the fix for the 2026-09-22 "blank spaces instead of icons"
 * report.
 *
 * WHY THIS EXISTS (the full failure chain, verified locally):
 *   The app renders every icon through @expo/vector-icons, whose font lives
 *   in a metro asset (require('…MaterialCommunityIcons.ttf')). On this
 *   monorepo the package is HOISTED to the workspace root node_modules —
 *   OUTSIDE mobile/ — so metro registers the asset under
 *   "/assets/_node_modules/…" and the RN CLI writes it to res/raw as
 *   "_node_modules_expo_vectoricons_…_materialcommunityicons.ttf". At
 *   runtime expo-font must then: resolve the asset module → look up the
 *   resource by identifier (getIdentifier(name,'raw')) → copy it to the
 *   cache dir → Typeface.createFromFile → ReactFontManager.setTypeface.
 *   Five links, any of which can silently fail on a given device/build —
 *   and when it fails, the Icon component renders an empty <Text/> forever:
 *   blank spots where icons should be and fully invisible icon-only
 *   buttons (the "I ended up clicking something I couldn't see" report).
 *
 * THE FIX — a zero-link path that Android itself has supported forever:
 *   ReactFontManager.getTypeface() lazily falls back to
 *   Typeface.createFromAsset(assets, "fonts/<family>.ttf") (see
 *   ReactAndroid …/common/assets/ReactFontManager.kt), and expo-font's
 *   getLoadedFonts() discovers assets/fonts/*.ttf natively — so a TTF at
 *     android/app/src/main/assets/fonts/material-community.ttf
 *   (named after the @expo/vector-icons font family) makes every icon
 *   render with NO runtime loading code at all. src/main/assets is packaged
 *   into the APK unconditionally by AGP — the same mechanism that carries
 *   res/ and AndroidManifest.xml, with no gradle wiring that can break.
 *
 * This module is BOTH:
 *   - a library (embedIconFont) used by the prebuild config plugin
 *     plugins/with-icon-font.js, and
 *   - a CLI (run directly) wired into package.json postinstall, so an
 *     EXISTING (stale) android/ prebuild folder gets the font too — the
 *     user must not have to re-run prebuild to repair their icons.
 *
 * Idempotent, loud, and fail-safe: a missing vector-icons package logs a
 * warning and exits 0 (never breaks npm install).
 */

const fs = require('fs')
const path = require('path')

const TAG = '[embed-icon-font]'
const VECTOR_ICONS_MODULE = '@expo/vector-icons'
const ICON_MODULE_REL = 'build/MaterialCommunityIcons.js'
const ANDROID_ASSETS_FONTS = path.join('android', 'app', 'src', 'main', 'assets', 'fonts')
const MIN_FONT_BYTES = 10000 // real MaterialCommunityIcons.ttf is ~350 KB

/**
 * Parse the icon module source for the createIconSet call and its font
 * import:
 *   import font from './vendor/…/Fonts/MaterialCommunityIcons.ttf';
 *   export default createIconSet(glyphMap, 'material-community', font);
 * Returns { fontName, fontSpecifier } — the family name RN must be able to
 * resolve ('material-community') and the font's module specifier
 * ('./vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf').
 * Handles BOTH shapes: a string literal as the third argument, or an
 * identifier imported from the TTF path (the @expo/vector-icons 15 shape).
 * Returns null when the shape changes upstream (never guess a name — a
 * mismatched family name silently reproduces the blank-icon bug).
 */
function parseIconModule(source) {
  const re =
    /createIconSet\(\s*glyphMap\s*,\s*['"]([^'"]+)['"]\s*,\s*(['"][^'"]+['"]|[\w$]+)\s*\)/
  const m = re.exec(source)
  if (!m) return null
  const fontName = m[1]
  let fontSpecifier = m[2]
  if (!fontSpecifier.startsWith("'") && !fontSpecifier.startsWith('"')) {
    // Third argument is an identifier — resolve it through its import:
    //   import font from './vendor/.../Fonts/MaterialCommunityIcons.ttf';
    const importRe = new RegExp(
      `import\\s+${fontSpecifier.replace(/[$]/g, '[$]')}\\s+from\\s+['"]([^'"]+)['"]`
    )
    const im = importRe.exec(source)
    if (!im) return null
    fontSpecifier = im[1]
  } else {
    fontSpecifier = fontSpecifier.slice(1, -1)
  }
  return { fontName, fontSpecifier }
}

/** Resolve the icon module file from the mobile root (monorepo-safe). */
function resolveIconModuleFile(mobileRoot) {
  const candidates = [
    path.join(mobileRoot, 'node_modules', VECTOR_ICONS_MODULE, ICON_MODULE_REL),
    path.join(mobileRoot, '..', 'node_modules', VECTOR_ICONS_MODULE, ICON_MODULE_REL)
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/**
 * Resolve a font specifier like
 * './vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'
 * against the icon module's directory.
 */
function resolveFontFile(iconModuleFile, fontSpecifier) {
  if (!fontSpecifier.startsWith('.')) return null
  return path.resolve(path.dirname(iconModuleFile), fontSpecifier)
}

/**
 * The embedder. Pure filesystem work, no expo APIs, so it runs equally from
 * postinstall (node CLI) and from prebuild (config plugin mod).
 *
 * Returns { ok, reason, fontName, target } — `ok:false` is always
 * non-fatal (logged loudly by the caller, never thrown).
 */
function embedIconFont(mobileRoot, log = () => {}) {
  const iconModuleFile = resolveIconModuleFile(mobileRoot)
  if (!iconModuleFile) {
    const reason = `${VECTOR_ICONS_MODULE}/${ICON_MODULE_REL} not found (not installed yet?)`
    log(`${TAG} skipped: ${reason}`)
    return { ok: false, reason }
  }

  let parsed
  try {
    parsed = parseIconModule(fs.readFileSync(iconModuleFile, 'utf8'))
  } catch (e) {
    const reason = `could not read ${iconModuleFile}: ${e.message}`
    log(`${TAG} skipped: ${reason}`)
    return { ok: false, reason }
  }
  if (!parsed) {
    // FAIL LOUDLY but do not break the install: an upstream reshape must be
    // noticed by a human, not silently ignored into a blank-icon release.
    const reason =
      `createIconSet call in ${VECTOR_ICONS_MODULE}/${ICON_MODULE_REL} no longer matches ` +
      `the expected shape — update ${__filename} (fontName/font path parsing)`
    log(`${TAG} WARNING: ${reason}`)
    return { ok: false, reason }
  }

  const { fontName, fontSpecifier } = parsed
  if (!/^[a-z0-9-]+$/.test(fontName)) {
    const reason = `unexpected font family name "${fontName}" (expected a lowercase hyphenated id)`
    log(`${TAG} WARNING: ${reason}`)
    return { ok: false, reason }
  }

  const fontFile = resolveFontFile(iconModuleFile, fontSpecifier)
  if (!fontFile || !fs.existsSync(fontFile)) {
    const reason = `font file ${fontSpecifier} not found next to the icon module`
    log(`${TAG} WARNING: ${reason}`)
    return { ok: false, reason }
  }
  const size = fs.statSync(fontFile).size
  if (size < MIN_FONT_BYTES) {
    const reason = `font file is only ${size} bytes — refusing to embed a broken TTF`
    log(`${TAG} WARNING: ${reason}`)
    return { ok: false, reason }
  }

  // Only embed when a prebuild output exists. Fresh installs (no android/
  // yet) are covered at prebuild time by plugins/with-icon-font.js.
  const androidMain = path.join(mobileRoot, 'android', 'app', 'src', 'main')
  if (!fs.existsSync(androidMain)) {
    log(`${TAG} no android/app/src/main yet — the prebuild plugin will embed the font`)
    return { ok: false, reason: 'no-android-folder' }
  }

  const fontsDir = path.join(mobileRoot, ANDROID_ASSETS_FONTS)
  const target = path.join(fontsDir, `${fontName}.ttf`)

  // Idempotent: when the exact same font is already embedded, skip the
  // rewrite entirely. The old unconditional copyFileSync made every
  // postinstall/prebuild run touch the APK asset — pointless mtime churn
  // (and the "is idempotent" test only passed when both writes happened to
  // land inside one filesystem mtime tick, i.e. it was a timing flake).
  const sameFont = () => {
    try {
      if (!fs.existsSync(target)) return false
      const targetStat = fs.statSync(target)
      if (targetStat.size !== size) return false
      return Buffer.compare(fs.readFileSync(fontFile), fs.readFileSync(target)) === 0
    } catch {
      return false // unreadable/odd target → just re-embed
    }
  }
  if (sameFont()) {
    log(`${TAG} ${fontName}.ttf already embedded (${(size / 1024).toFixed(0)} KB) — nothing to do`)
    return { ok: true, reason: null, fontName, target }
  }

  fs.mkdirSync(fontsDir, { recursive: true })
  fs.copyFileSync(fontFile, target)
  log(`${TAG} embedded ${fontName}.ttf (${(size / 1024).toFixed(0)} KB) -> ${path.relative(mobileRoot, target)}`)
  log(`${TAG} ReactFontManager now resolves the "${fontName}" family straight from APK assets — icons can no longer ship blank`)
  return { ok: true, reason: null, fontName, target }
}

module.exports = { embedIconFont, parseIconModule, resolveIconModuleFile, resolveFontFile, TAG, ANDROID_ASSETS_FONTS, MIN_FONT_BYTES }

if (require.main === module) {
  const mobileRoot = path.resolve(__dirname, '..')
  const result = embedIconFont(mobileRoot, console.log)
  if (!result.ok && result.reason !== 'no-android-folder') {
    console.warn(`${TAG} NOTE: icons on device fall back to the fragile runtime asset path until this is fixed.`)
  }
}
