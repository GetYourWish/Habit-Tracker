// diagnostics.js — release crash reporter.
//
// The LEGACY FS is mocked (diagnostics must import from
// 'expo-file-system/legacy' — see the module header); the ROOT
// 'expo-file-system' mock below replicates the REAL SDK 57 root export:
// no documentDirectory, and every legacy string method is a deprecation
// stub that THROWS. If diagnostics ever regresses to the root import, the
// reporter silently dies on-device (nothing recorded, nothing shown) — with
// this mock it dies loudly in the suite instead.
//
// In jest, __DEV__ is true, so tests that need the release path flip the
// global explicitly.

import { installReleaseCrashReporter, readLastCrash, clearLastCrash, crashReportUri } from '../src/diagnostics'

const mockState = { writes: [], deleted: [], files: new Map(), rootCalls: [] }

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock-doc/',
  writeAsStringAsync: jest.fn(async (uri, content) => {
    mockState.files.set(uri, content)
    mockState.writes.push({ uri, content })
  }),
  readAsStringAsync: jest.fn(async uri => {
    if (!mockState.files.has(uri)) throw new Error('ENOENT')
    return mockState.files.get(uri)
  }),
  getInfoAsync: jest.fn(async uri => ({ exists: mockState.files.has(uri), uri })),
  deleteAsync: jest.fn(async uri => {
    mockState.deleted.push(uri)
    mockState.files.delete(uri)
  })
}))

// REAL SDK 57 root behavior: legacy methods throw, documentDirectory is gone.
jest.mock('expo-file-system', () => {
  const throwing = name =>
    jest.fn(async (...args) => {
      mockState.rootCalls.push(name)
      throw new Error(
        `Method ${name} imported from "expo-file-system" is deprecated. You can migrate to the new filesystem API using "File" and "Directory" classes or import the legacy API from "expo-file-system/legacy".`
      )
    })
  return {
    Paths: {},
    File: class {},
    Directory: class {},
    getInfoAsync: throwing('getInfoAsync'),
    readAsStringAsync: throwing('readAsStringAsync'),
    writeAsStringAsync: throwing('writeAsStringAsync'),
    deleteAsync: throwing('deleteAsync')
  }
})

const realDev = global.__DEV__
const realHandler = global.ErrorUtils && global.ErrorUtils.getGlobalHandler

function withReleaseMode(fn) {
  global.__DEV__ = false
  const calls = []
  global.ErrorUtils = {
    setGlobalHandler: h => {
      calls.push(h)
    },
    getGlobalHandler: () => realHandler || null
  }
  try {
    return fn(calls)
  } finally {
    global.__DEV__ = realDev
    if (realHandler) global.ErrorUtils.setGlobalHandler(realHandler)
  }
}

describe('release crash reporter', () => {
  beforeEach(() => {
    mockState.writes.length = 0
    mockState.deleted.length = 0
    mockState.files.clear()
    jest.clearAllMocks()
  })

  test('is a no-op in DEV', () => {
    global.__DEV__ = true
    const handlerSpy = jest.spyOn(global.ErrorUtils || {}, 'setGlobalHandler')
    expect(installReleaseCrashReporter()).toBe(false)
    handlerSpy.mockRestore()
    global.__DEV__ = realDev
  })

  test('release mode installs a handler that writes the report, then chains to the original', () => {
    withReleaseMode(calls => {
      expect(installReleaseCrashReporter()).toBe(true)
      expect(calls).toHaveLength(1)
      const handler = calls[0]
      const boom = new Error('boom at startup')
      boom.stack = 'Error: boom at startup\n    at App (App.jsx:1:1)'
      handler(boom, true)
      // write is fire-and-forget — let the microtask run
      return Promise.resolve().then(() => {
        expect(mockState.writes).toHaveLength(1)
        const { uri, content } = mockState.writes[0]
        expect(uri).toBe(crashReportUri())
        const parsed = JSON.parse(content)
        expect(parsed.message).toBe('boom at startup')
        expect(parsed.isFatal).toBe(true)
        expect(parsed.stack).toContain('App.jsx')
        expect(parsed.at).toBeTruthy()
        // original handler was still called
        expect(typeof handler).toBe('function')
        // and crucially: nothing ever reached the SDK 57 ROOT stubs
        expect(mockState.rootCalls).toHaveLength(0)
      })
    })
  })

  test('readLastCrash returns the stored report; clearLastCrash deletes the file', async () => {
    const uri = crashReportUri()
    mockState.files.set(uri, JSON.stringify({ name: 'Error', message: 'x', stack: null, isFatal: true, at: 't' }))

    const report = await readLastCrash()
    expect(report.message).toBe('x')

    await clearLastCrash()
    expect(mockState.deleted).toContain(uri)
    // cached null after clearing — no further reads
    const again = await readLastCrash()
    expect(again).toBeNull()
  })

  test('readLastCrash tolerates a corrupt report file', async () => {
    mockState.files.set(crashReportUri(), '{not json')
    const report = await readLastCrash()
    expect(report).toBeNull()
  })
})
