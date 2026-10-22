import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { isLocalResourceUrl } = require('../../electron/netlock.cjs')

// THE offline guarantee (user report 2026-10-22): the desktop app must not
// open web sockets or reach the internet in any way. The decision function
// behind the session's webRequest gate is pure — test it exhaustively here
// so the lockdown can never silently regress.

describe('netlock — isLocalResourceUrl (the offline gate)', () => {
  // ---- packaged (production) mode: allowDevServer = false --------------
  it('allows file:// resources (the packaged app loads its UI from disk)', () => {
    expect(isLocalResourceUrl('file:///C:/apps/Habit%20Tracker/resources/dist/index.html')).toBe(true)
    expect(isLocalResourceUrl('file:///home/user/app/dist/index.html')).toBe(true)
    expect(isLocalResourceUrl('file:///C:/SyncThis/habit.json')).toBe(true)
  })

  it('blocks EVERY http/https request in production mode', () => {
    expect(isLocalResourceUrl('http://example.com/')).toBe(false)
    expect(isLocalResourceUrl('https://example.com/app.js')).toBe(false)
    expect(isLocalResourceUrl('http://1.2.3.4/telemetry')).toBe(false)
    expect(isLocalResourceUrl('https://localhost:5173/')).toBe(false) // no dev server in production
    expect(isLocalResourceUrl('http://127.0.0.1:8080/api')).toBe(false)
  })

  it('blocks WebSocket handshakes in production mode', () => {
    expect(isLocalResourceUrl('ws://example.com/socket')).toBe(false)
    expect(isLocalResourceUrl('wss://example.com/socket')).toBe(false)
    expect(isLocalResourceUrl('ws://localhost:5173/hmr')).toBe(false)
  })

  it('blocks garbage and non-local protocols', () => {
    expect(isLocalResourceUrl('not a url')).toBe(false)
    expect(isLocalResourceUrl('')).toBe(false)
    expect(isLocalResourceUrl('ftp://example.com/file')).toBe(false)
  })

  it('always allows devtools:// internals (dev tooling, not network)', () => {
    expect(isLocalResourceUrl('devtools://devtools/bundled/inspector.html')).toBe(true)
  })

  // ---- unpackaged (development) mode: allowDevServer = true ------------
  it('allows the local Vite dev server (http + ws) in development runs only', () => {
    const dev = { allowDevServer: true }
    expect(isLocalResourceUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isLocalResourceUrl('http://localhost:5173/src/main.jsx', dev)).toBe(true)
    expect(isLocalResourceUrl('ws://localhost:5173/hmr', dev)).toBe(true)
    expect(isLocalResourceUrl('http://127.0.0.1:5173/', dev)).toBe(true)
  })

  it('still blocks the internet in development runs', () => {
    const dev = { allowDevServer: true }
    expect(isLocalResourceUrl('http://example.com/', dev)).toBe(false)
    expect(isLocalResourceUrl('https://cdn.example.net/lib.js', dev)).toBe(false)
    expect(isLocalResourceUrl('wss://sockets.example.com/', dev)).toBe(false)
    // A non-loopback host that merely CONTAINS "localhost" must not pass.
    expect(isLocalResourceUrl('http://localhost.evil.com/', dev)).toBe(false)
    expect(isLocalResourceUrl('http://my-localhost:5173/', dev)).toBe(false)
  })

  it('still blocks non-http(s) schemes in development runs', () => {
    const dev = { allowDevServer: true }
    expect(isLocalResourceUrl('ftp://localhost:21/', dev)).toBe(false)
  })
})
