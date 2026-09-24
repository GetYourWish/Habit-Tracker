// JSX binding audit — every capitalized JSX tag in the app's source must
// resolve to a binding that is actually declared in that file (an import or
// a local declaration).
//
// REGRESSION THIS GUARDS:
//   CategorySheet.js rendered <TextInput> in its create-category form while
//   TextInput was NOT in the react-native import list — the identifier was
//   `undefined`, so the very first "New category" tap would crash the app
//   with "Element type is invalid: expected a string … but got: undefined".
//   No jest render test ever opened that branch, so only a static audit can
//   catch this class of bug (a missing *declaration*, as opposed to a
//   declared-but-undefined import, which package-contract.test.js covers).
//
// Companion of package-contract.test.js:
//   - THIS file catches tags with no declaration at all.
//   - package-contract catches declarations whose runtime value is undefined
//     (import shape ≠ real module export shape).

const fs = require('fs')
const path = require('path')

const MOBILE_ROOT = path.resolve(__dirname, '..')

function appSourceFiles() {
  const files = [path.join(MOBILE_ROOT, 'App.jsx')]
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === 'node_modules') continue
        walk(p)
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) {
        files.push(p)
      }
    }
  }
  walk(path.join(MOBILE_ROOT, 'src'))
  return files
}

function declaredBindings(src) {
  const defined = new Set()
  // import Default, { named as alias } from '...'
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s+from/g)) {
    if (m[1]) defined.add(m[1])
    if (m[2]) collectNamed(m[2], defined)
  }
  // import { ... } from '...'
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s+from/g)) collectNamed(m[1], defined)
  // import * as NS from '...'
  for (const m of src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1])
  // local declarations
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1])
  // destructuring declarations (const { a, b: c } = ...)
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) collectNamed(m[1], defined)
  return defined
}

function collectNamed(list, set) {
  for (const part of list.split(',')) {
    const as = part.split(/\s+as\s+/)
    const name = (as[1] || as[0] || '').trim()
    if (name) set.add(name)
  }
}

describe('JSX binding audit (no undefined element types)', () => {
  const files = appSourceFiles()

  test('audit covers the whole app tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(files.map(f => path.relative(MOBILE_ROOT, f))).toContain('src/components/CategorySheet.js')
  })

  test.each(files.map(f => [path.relative(MOBILE_ROOT, f), f]))('%s: every JSX tag resolves to a declared binding', (_rel, file) => {
    const src = fs.readFileSync(file, 'utf8')
    const defined = declaredBindings(src)
    const offenders = []
    for (const m of src.matchAll(/<([A-Z][\w$.]*)/g)) {
      const root = m[1].split('.')[0]
      if (!defined.has(root)) offenders.push(m[1])
    }
    expect(offenders).toEqual([]) // failure message lists the undefined tags
  })

  test('the audit itself detects the historical TextInput bug', () => {
    const buggy = [
      "import { View } from 'react-native'",
      'function X() { return <View><TextInput /></View> }'
    ].join('\n')
    const defined = declaredBindings(buggy)
    const offenders = []
    for (const m of buggy.matchAll(/<([A-Z][\w$.]*)/g)) {
      if (!defined.has(m[1].split('.')[0])) offenders.push(m[1])
    }
    expect(offenders).toEqual(['TextInput'])
  })
})
