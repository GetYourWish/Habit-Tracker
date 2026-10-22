// netlock.cjs — the desktop app's NETWORK LOCKDOWN (2026-10-22 user report:
// "the app should not be opening web sockets / access the internet in no
// way — syncing is done by a SEPARATE service such as Syncthing; the app
// itself only reads and writes habit.json locally").
//
// This module is deliberately Electron-free: the decision logic is a pure
// function so it can be unit-tested (desktop/src/__tests__/netlock.test.js)
// without booting a BrowserWindow. main.cjs wires it into the real session.
//
// Policy (non-negotiable):
//   - file:// is always allowed — it is the ONLY way the packaged app loads
//     its own UI (mainWindow.loadFile(dist/index.html)).
//   - In an UNPACKAGED run (development), http/ws to the local Vite dev
//     server on loopback (localhost / 127.0.0.1 / [::1], any port) is
//     allowed — that is the dev toolchain, never shipped to users.
//   - In a PACKAGED app, EVERY http/https/ws/wss/ftp request is cancelled —
//     WebSocket handshakes included (a WS handshake is an HTTP request and
//     dies in the same onBeforeRequest hook). The app cannot fetch, XHR,
//     connect to a socket, or load a remote script even if a bug (or a
//     future dependency) tried to: the request never leaves the process.
//
// Companion switches set by main.cjs BEFORE app ready:
//   --disable-background-networking  Chromium background services (component
//                                    update, safe browsing, network time,
//                                    DNS prefetch) never start.
//   --disable-component-update      belt-and-braces for the updater.

'use strict'

// Loopback hostnames the dev server may run on.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Should a request to `rawUrl` be allowed through the webRequest gate?
 *
 * @param {string} rawUrl the request URL as Chromium reports it
 * @param {object} [opts]
 * @param {boolean} [opts.allowDevServer=false] true only in unpackaged runs
 * @returns {boolean} true → allow, false → cancel
 */
function isLocalResourceUrl(rawUrl, opts) {
  const allowDevServer = !!(opts && opts.allowDevServer)
  let url
  try {
    url = new URL(rawUrl)
  } catch (e) {
    return false
  }
  // The packaged UI is file:// — always local, always allowed.
  if (url.protocol === 'file:') return true
  // Dev tools internals (dev mode opens them automatically).
  if (url.protocol === 'devtools:' || url.protocol === 'chrome-devtools:') return true
  // Unpacked dev runs may talk to the local Vite/Metro-style dev server.
  if (allowDevServer && (url.protocol === 'http:' || url.protocol === 'ws:')) {
    const host = url.hostname === '[::1]' ? '[::1]' : url.hostname
    if (LOOPBACK_HOSTS.has(host)) return true
  }
  return false
}

/**
 * Configure the hard lockdown on a BrowserWindow's session. Impure —
 * wired to Electron in main.cjs, kept here so the policy lives in one file.
 *
 * @param {Electron.BrowserWindow} win
 * @param {boolean} allowDevServer
 */
function lockDownWindow(win, allowDevServer) {
  const ses = win.webContents.session

  // 1. THE gate: cancel every network-scheme request that is not local.
  //    ('*://*/*' matches http/https/ws/wss/ftp — file:// and devtools://
  //    never enter this filter, and loopback is only allowed in dev runs.)
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    callback({ cancel: !isLocalResourceUrl(details.url, { allowDevServer }) })
  })

  // 2. No popups, no auxiliary windows, no webviews from renderer code.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 3. Never navigate away from local content (a stray link click or a
  //    window.location change must not turn into a network load).
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalResourceUrl(url, { allowDevServer })) event.preventDefault()
  })

  // 4. Deny every web permission request (geolocation, media, midi, …).
  //    Nothing in this app uses any of them.
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false)
  })
}

module.exports = { isLocalResourceUrl, lockDownWindow, LOOPBACK_HOSTS }
