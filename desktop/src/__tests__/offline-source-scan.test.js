// Offline source-scan guard (round 3, 2026-10-23): the user's strict
// constraint — the desktop app must maintain the netlock.cjs lockdown and
// "do not introduce any code that makes HTTP requests, WebSocket
// connections, or DNS lookups (fetch, axios, XMLHttpRequest)".
//
// netlock.cjs already cancels every non-file request at the session level
// (functional tests in netlock.test.js), and Chromium background
// networking is disabled at startup — so a stray network call could never
// actually leave the process. This test is the code-level twin: it scans
// every shipped source file (renderer + main + preload) and fails at the
// first match, so network client code can never creep in unnoticed.
//
// Scanned: desktop/src/** (renderer bundle) and desktop/electron/*.cjs
// (main + preload + netlock itself — netlock only NAMES protocols to
// block them and passes these patterns cleanly). Not scanned: __tests__,
// scripts/ (dev tooling) and build output.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// One regex per forbidden API family. Kept explicit and word-bounded so
// comments mentioning e.g. "offline" or "fetching from disk" do not trip.
const FORBIDDEN_PATTERNS = [
  /\bfetch\s*\(/,
  /new\s+XMLHttpRequest/,
  /\baxios\b/,
  /new\s+WebSocket\b/,
  /\bWebSocket\b\s*\(/,
  /require\(\s*['"]https?['"]\s*\)/,
  /require\(\s*['"]net['"]\s*\)/,
  /require\(\s*['"]dns['"]\s*\)/,
  /require\(\s*['"]node:https?['"]\s*\)/,
  /require\(\s*['"]node:net['"]\s*\)/,
  /require\(\s*['"]node:dns['"]\s*\)/,
  /import\s+[^'"]*from\s+['"]https?['"]/,
  /import\s+[^'"]*from\s+['"]node:https?['"]/,
  /\bnet\.request\s*\(/
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
  "import from 'node:http'/'node:https'",
  'electron net.request()'
]

function listSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test-setup.js') continue
      listSourceFiles(full, out)
    } else if (/\.(js|jsx|cjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('offline source scan (desktop)', () => {
  test('the app source contains no network-call APIs', () => {
    const files = [
      ...listSourceFiles(path.join(desktopRoot, 'src'), []),
      ...listSourceFiles(path.join(desktopRoot, 'electron'), [])
    ]
    // sanity: the scan saw the renderer, main, preload and netlock
    const names = files.map(f => path.basename(f))
    for (const expected of ['main.cjs', 'preload.cjs', 'netlock.cjs']) {
      expect(names).toContain(expected)
    }
    expect(files.length).toBeGreaterThan(10)

    const violations = []
    for (const file of files) {
      const rel = path.relative(desktopRoot, file)
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
