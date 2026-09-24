// Unit tests for the expo-file-system SAF truncate patch in
// mobile/plugins/patch-expo-saf-truncate.js.
//
// The 2026-09-21 remote-reported failure: EVERY mutation (theme change,
// adding a task) ended on the corrupt-file recovery screen with
//   "Corrupt JSON: JSON Parse error: Unexpected character: }"
// while "Restore latest backup" kept working — and the next action corrupted
// the file again. Root cause: expo's legacy writeAsStringAsync opens a SAF
// document with openOutputStream(uri, "w"), a mode whose truncation of an
// EXISTING document is provider-dependent. Providers that do not truncate
// leave the previous (longer) content's tail bytes behind after a shorter
// write — a complete new JSON followed by the old document's final '}' is
// exactly the parse error above. The patch opens with "rwt" (the
// openOutputStream mode that carries MODE_TRUNCATE explicitly) and falls
// back to "w" only if a provider rejects it.
//
// The ANCHOR below is the pristine expo-file-system 57.0.6 source; the
// transform tests are pure string work. The wiring tests pin that the patch
// actually runs (postinstall + prebuild plugin + app.json), so a fresh
// clone cannot silently compile an unpatched module.

const fs = require('fs')
const path = require('path')

const {
  patchGetOutputStreamSource,
  ANCHOR,
  MARKER
} = require('../plugins/patch-expo-saf-truncate')

const mobileRoot = path.join(__dirname, '..')

describe('patchGetOutputStreamSource (pure transform)', () => {
  test('rewrites the "w" open into the truncating "rwt" with a fallback', () => {
    const warn = jest.spyOn(console, 'log').mockImplementation(() => {})
    const out = patchGetOutputStreamSource(ANCHOR, 'FileSystemLegacyModule.kt')
    expect(out).not.toBeNull()
    expect(out).toContain('val mode = if (append) "wa" else "rwt"')
    expect(out).toContain('context.contentResolver.openOutputStream(uri, mode)!!')
    // fallback to expo's original behavior for providers that reject "rwt"
    expect(out).toContain('context.contentResolver.openOutputStream(uri, "w")!!')
    // append mode is untouched
    expect(out).toContain('if (append) "wa"')
    // file:// and unsupported-scheme branches survive verbatim
    expect(out).toContain('FileOutputStream(uri.toFile(), append)')
    expect(out).toContain('Unsupported scheme for location')
    expect(typeof out).toBe('string')
    warn.mockRestore()
  })

  test('is idempotent (already patched source is returned unchanged)', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const once = patchGetOutputStreamSource(ANCHOR, 'x.kt')
    const twice = patchGetOutputStreamSource(once, 'x.kt')
    expect(twice).toBe(once)
    expect(twice.split(MARKER).length - 1).toBe(1)
    log.mockRestore()
  })

  test('returns null with a warning when expo reshapes the function', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const out = patchGetOutputStreamSource('package expo.modules.filesystem\n', 'x.kt')
    expect(out).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the installed expo-file-system module is actually patched', () => {
  const kt = path.join(
    mobileRoot,
    '..',
    'node_modules',
    'expo-file-system',
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'filesystem',
    'legacy',
    'FileSystemLegacyModule.kt'
  )

  // The npm postinstall of @habit-tracker/mobile applies the patch to
  // the hoisted node_modules tree; this pins that wiring so a build can never
  // silently compile the non-truncating "w" open back in.
  test('getOutputStream opens SAF documents with "rwt" (or the anchor drifted)', () => {
    if (!fs.existsSync(kt)) {
      test.skip('expo-file-system legacy module not installed here')
      return
    }
    const src = fs.readFileSync(kt, 'utf8')
    expect(src).toContain(MARKER)
    expect(src).toContain('context.contentResolver.openOutputStream(uri, mode)!!')
  })
})

describe('patch wiring (a fresh clone cannot compile it away)', () => {
  test('postinstall chain includes the truncate patch', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts.postinstall).toContain('patch-expo-saf-truncate.js')
  })

  test('app.json registers the prebuild plugin', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
    expect(appJson.expo.plugins).toContain('./plugins/with-expo-saf-truncate')
  })

  test('the prebuild plugin re-exports the patcher', () => {
    const plugin = require('../plugins/with-expo-saf-truncate')
    expect(typeof plugin).toBe('function')
  })
})
