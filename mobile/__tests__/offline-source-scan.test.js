// Offline source-scan guard (round 3, 2026-10-23): the user's strict
// constraint — "Do not introduce any code that makes HTTP requests,
// WebSocket connections, or DNS lookups (fetch, axios, XMLHttpRequest)".
//
// The Android manifest cannot carry network permissions (see
// plugins/with-offline-manifest.js and its AAR ground-truth tests), so a
// stray network call could never actually reach the internet — but the
// constraint is about the CODE too, not just the OS gate. This test scans
// every shipped source file of the mobile app and fails at the first
// match, so a copy-pasted fetch() or a dependency import that shims
// XMLHttpRequest can never slip in unnoticed.
//
// Scanned: mobile/src/** and mobile/App.jsx (everything that ships in the
// JS bundle). Not scanned: __tests__ (this file), plugins/ (build-time
// tooling that never enters the bundle — it writes manifest text), and
// node_modules (covered structurally by the manifest markers).

const fs = require('fs')
const path = require('path')

// One regex per forbidden API family. Kept explicit and word-bounded so
// comments mentioning e.g. "offline" or "fetching from disk" do not trip.
const FORBIDDEN_PATTERNS = [
  // global browser/node HTTP clients
  /\bfetch\s*\(/,
  /new\s+XMLHttpRequest/,
  /\baxios\b/,
  // sockets
  /new\s+WebSocket\b/,
  /\bWebSocket\b\s*\(/,
  // node core network modules (require or import)
  /require\(\s*['"]https?['"]\s*\)/,
  /require\(\s*['"]net['"]\s*\)/,
  /require\(\s*['"]dns['"]\s*\)/,
  /require\(\s*['"]node:https?['"]\s*\)/,
  /require\(\s*['"]node:net['"]\s*\)/,
  /require\(\s*['"]node:dns['"]\s*\)/,
  /import\s+[^'"]*from\s+['"]https?['"]/,
  /import\s+[^'"]*from\s+['"]node:https?['"]/
]

const PATTERN_LABELS = [
  'fetch()',
  'XMLHttpRequest',
  'axios',
  'WebSocket',
  'WebSocket()',
  "require('http'/'https')",
  "require('net')",
  "require('dns')",
  "require('node:http'/'node:https')",
  "require('node:net')",
  "require('node:dns')",
  "import from 'http'/'https'",
  "import from 'node:http'/'node:https'"
]

function listSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listSourceFiles(full, out)
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('offline source scan (mobile)', () => {
  const mobileRoot = path.resolve(__dirname, '..')

  test('the app source contains no network-call APIs', () => {
    const roots = [path.join(mobileRoot, 'src'), path.join(mobileRoot, 'App.jsx')]
    const files = []
    for (const root of roots) {
      if (fs.statSync(root).isFile()) {
        files.push(root)
      } else {
        listSourceFiles(root, files)
      }
    }
    expect(files.length).toBeGreaterThan(20) // sanity: the scan saw the app

    const violations = []
    for (const file of files) {
      const rel = path.relative(mobileRoot, file)
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        FORBIDDEN_PATTERNS.forEach((pattern, p) => {
          if (pattern.test(line)) {
            violations.push(rel + ':' + (i + 1) + ' → ' + PATTERN_LABELS[p] + ' — ' + line.trim())
          }
        })
      })
    }
    expect(violations.join('\n')).toBe('')
  })
})
