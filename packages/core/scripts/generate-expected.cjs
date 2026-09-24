// Generator for packages/core/__fixtures__/expected.json.
// Run: node scripts/generate-expected.cjs (from packages/core)
// Regenerating is a BREAKING change to the drift contract — every value must
// be hand-verified against the documented formula before committing.
'use strict'

const fs = require('fs')
const path = require('path')
const { computeActual } = require('../tests/fixture-contract.cjs')

const fixturesDir = path.join(__dirname, '..', 'fixtures')
const outPath = path.join(__dirname, '..', '__fixtures__', 'expected.json')

const expected = {}
for (const name of fs.readdirSync(fixturesDir).filter(n => n.endsWith('.json')).sort()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
  expected[name] = computeActual(fixture)
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(expected, null, 2) + '\n', 'utf8')
console.log('Wrote', path.relative(process.cwd(), outPath), 'for', Object.keys(expected).join(', '))
