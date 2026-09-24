// icon-names.test.js — every icon name that can reach a MaterialCommunityIcons
// <Icon name=…> / <IconBtn name=…> / nav-tab icon must exist in the glyphmap.
//
// REGRESSION THIS GUARDS:
//   SettingsScreen rendered name="check-box-outline" — not a real
//   material-community name (the real one is "checkbox-outline") — so the
//   dashboard-card visibility switches showed a missing-glyph box on device,
//   the same "blank spaces instead of icons" class as the v1.0.9 incident.
//   No render test catches a wrong-but-string icon name (the component
//   renders fine; only the glyph is wrong), so only a static audit can.

const fs = require('fs')
const path = require('path')

const mobileRoot = path.join(__dirname, '..')

// @expo/vector-icons is hoisted to the workspace root in this monorepo —
// resolve the glyphmap from either node_modules tree (jest modulePaths also
// teaches jest-resolve both trees).
function loadGlyphmap() {
  const rel = 'build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json'
  for (const base of [path.join(mobileRoot, '..'), mobileRoot]) {
    const p = path.join(base, 'node_modules', '@expo/vector-icons', rel)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  }
  throw new Error('MaterialCommunityIcons glyphmap not found in either node_modules tree')
}

function appSourceFiles() {
  const files = [path.join(mobileRoot, 'App.jsx')]
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) files.push(p)
    }
  }
  walk(path.join(mobileRoot, 'src'))
  return files
}

// Extract every quoted string inside a name=/icon=/iconActive= prop
// expression (covers literals AND ternary arms) plus icon: object keys.
function extractIconNames(src) {
  const names = new Set()
  const addQuoted = block => {
    for (const m of block.matchAll(/["']([a-z0-9-]+)["']/g)) names.add(m[1])
  }
  for (const m of src.matchAll(/\b(?:name|icon|iconActive|iconInactive)=("[^"]*"|\{[^}]*\})/g)) {
    addQuoted(m[1])
  }
  for (const m of src.matchAll(/\b(?:icon|iconActive)\s*:\s*("[^"]*"|'[^']*')/g)) {
    addQuoted(m[1])
  }
  return names
}

describe('icon name audit (every glyph resolves in material-community)', () => {
  const glyphmap = loadGlyphmap()
  const files = appSourceFiles()

  test('the audit covers the whole app tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(files.map(f => path.relative(mobileRoot, f))).toContain('src/components/BoardScreen.js')
  })

  test.each(files.map(f => [path.relative(mobileRoot, f), f]))(
    '%s: every icon name exists in the glyphmap',
    (_rel, file) => {
      const src = fs.readFileSync(file, 'utf8')
      const offenders = []
      for (const name of extractIconNames(src)) {
        if (!(name in glyphmap)) offenders.push(name)
      }
      expect(offenders).toEqual([]) // failure message lists the bad names
    }
  )

  test('the audit itself detects the historical check-box-outline bug', () => {
    const buggy = "name={checked ? 'check-box-outline' : 'checkbox-blank-outline'}"
    const offenders = [...extractIconNames(buggy)].filter(n => !(n in glyphmap))
    expect(offenders).toEqual(['check-box-outline'])
  })
})
