// Package contract test — v1.0.7 edition.
//
// HISTORY: this file used to pin react-native-draggable-flatlist's real
// export shape (the 2026-09-17 "Element type is invalid" crash was a named
// import of a default-only export — Metro bundles missing exports
// silently). In v1.0.7 the ENTIRE drag library (plus reanimated, worklets
// and gesture-handler) was REMOVED: it is unmaintained for React 19 /
// reanimated 4 / RN 0.87 (last release 4.0.3, open crash issues #496/#524/
// #558) and it was the prime suspect for the remote-reported "create a
// task → crash".
//
// The contract now guards the removal itself:
//  1. the risky packages are NOT direct dependencies of the app
//  2. no app source file imports them (a stray import of a package that is
//     no longer installed fails the Metro bundle — but a TRANSITIVE install
//     would silently revive it, so we pin the source scan too)
//  3. every runtime dependency in package.json actually resolves
//  4. the babel config no longer registers the worklets plugin
//
// Same failure class as before: the build tooling is happy while the app
// ships a runtime landmine. CI must catch it first.

const fs = require('fs')
const path = require('path')

const mobileRoot = path.join(__dirname, '..')

const REMOVED_PACKAGES = [
  'react-native-draggable-flatlist',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler'
]

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'android' || entry.name === '.bundle-check') continue
      listSourceFiles(p, out)
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

describe('removed risky packages stay removed', () => {
  test('none of the removed packages is a direct dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    for (const name of REMOVED_PACKAGES) {
      expect(pkg.dependencies).not.toHaveProperty(name)
      expect(pkg.devDependencies).not.toHaveProperty(name)
    }
  })

  test('no app source file imports a removed package', () => {
    const files = [
      ...listSourceFiles(path.join(mobileRoot, 'src')),
      path.join(mobileRoot, 'App.jsx'),
      path.join(mobileRoot, 'index.js')
    ]
    const offenders = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      // comments that mention the removal are fine — only import/require
      // statements count
      const importRe = /(?:import\s[^;]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
      let m
      while ((m = importRe.exec(src)) !== null) {
        for (const name of REMOVED_PACKAGES) {
          if (m[1] === name || m[1].startsWith(name + '/')) {
            offenders.push(path.relative(mobileRoot, file) + ' → ' + m[1])
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('every runtime dependency resolves (no phantom imports)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    for (const name of Object.keys(pkg.dependencies)) {
      expect(() => require.resolve(path.join(name, 'package.json'))).not.toThrow()
    }
  })

  test('babel config no longer registers the worklets plugin', () => {
    const babel = fs.readFileSync(path.join(mobileRoot, 'babel.config.js'), 'utf8')
    expect(babel).not.toMatch(/react-native-worklets\/plugin/)
    expect(babel).not.toMatch(/react-native-reanimated\/plugin/)
  })
})

describe('BoardScreen renders the board with first-party components only', () => {
  test('the board list is a plain RN FlatList (no drag library)', () => {
    const board = fs.readFileSync(path.join(mobileRoot, 'src', 'components', 'BoardScreen.js'), 'utf8')
    expect(board).toMatch(/import\s*\{[^}]*FlatList[^}]*\}\s*from\s+'react-native'/)
    expect(board).toMatch(/<FlatList/)
    // the reorder flow uses the moveItem action (desktop parity)
    expect(board).toMatch(/\bmoveItem\b/)
  })

  test('rows support rearrange mode with up/down move buttons', () => {
    const rows = fs.readFileSync(path.join(mobileRoot, 'src', 'components', 'rows.js'), 'utf8')
    expect(rows).toMatch(/onMoveUp/)
    expect(rows).toMatch(/onMoveDown/)
    expect(rows).toMatch(/canMoveUp/)
    expect(rows).toMatch(/canMoveDown/)
  })
})
