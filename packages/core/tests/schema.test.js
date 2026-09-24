import { describe, it, expect } from 'vitest'
import { checkSchemaVersion, validateAndHealData, createDefaultData } from '../index.js'

describe('checkSchemaVersion (Phase 2: refuse future schema files)', () => {
  it('refuses a numeric schemaVersion > 1', () => {
    expect(checkSchemaVersion({ schemaVersion: 2 }).ok).toBe(false)
    expect(checkSchemaVersion({ schemaVersion: 2 }).schemaVersion).toBe(2)
    expect(checkSchemaVersion({ schemaVersion: 99 }).schemaVersion).toBe(99)
    expect(checkSchemaVersion({ schemaVersion: 99 }).message).toContain('SCHEMA_VERSION_TOO_NEW')
  })

  it('accepts schemaVersion 1', () => {
    expect(checkSchemaVersion({ schemaVersion: 1 }).ok).toBe(true)
  })

  it('treats missing schemaVersion as 1 (legacy files)', () => {
    expect(checkSchemaVersion({}).ok).toBe(true)
    expect(checkSchemaVersion({ tasks: [] }).ok).toBe(true)
    expect(checkSchemaVersion(null).ok).toBe(true)
  })

  it('treats non-number schemaVersion as 1', () => {
    expect(checkSchemaVersion({ schemaVersion: '2' }).ok).toBe(true) // string, not a number
    expect(checkSchemaVersion({ schemaVersion: null }).ok).toBe(true)
    expect(checkSchemaVersion({ schemaVersion: undefined }).ok).toBe(true)
  })

  it('accepts schemaVersion <= 1 numbers', () => {
    expect(checkSchemaVersion({ schemaVersion: 0 }).ok).toBe(true)
    expect(checkSchemaVersion({ schemaVersion: -3 }).ok).toBe(true)
  })
})

describe('validateAndHealData (Phase 2: no updatedAt churn, idempotent healing)', () => {
  const FIXED_TS = '2026-08-01T10:00:00.000Z'

  it('does NOT bump meta.updatedAt when healing an already-valid file', () => {
    const file = createDefaultData()
    file.meta.createdAt = FIXED_TS
    file.meta.updatedAt = FIXED_TS

    const healed = validateAndHealData(file)
    expect(healed.meta.updatedAt).toBe(FIXED_TS)
    expect(healed.meta.createdAt).toBe(FIXED_TS)
  })

  it('healing an already-valid file is byte-identical (no pointless rewrites)', () => {
    const file = createDefaultData()
    // A file as actually written by the app includes the healed-in sections
    file.workingOn = []
    file.logs = []
    file.meta.createdAt = FIXED_TS
    file.meta.updatedAt = FIXED_TS

    const healed = validateAndHealData(file)
    // The main process persists only when serialized output differs from what
    // was read. Healing must therefore serialize identically for clean files.
    expect(JSON.stringify(healed)).toBe(JSON.stringify(file))
  })

  it('repairs a file needing healing but still preserves meta.updatedAt', () => {
    const file = {
      schemaVersion: 1,
      meta: { createdAt: FIXED_TS, updatedAt: FIXED_TS },
      settings: { theme: 'dark' },
      difficulties: [{ id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true }],
      categories: [],
      markers: [],
      board: [],
      tasks: [{ id: 't1', text: 'Active task' }] // active task missing from board -> must be healed in
    }
    const healed = validateAndHealData(file)
    expect(healed.board).toEqual([{ type: 'task', taskId: 't1' }])
    expect(healed.meta.updatedAt).toBe(FIXED_TS) // repair != churn
  })

  it('creates meta only when missing (that one-time creation may persist)', () => {
    const healed = validateAndHealData({ schemaVersion: 1, tasks: [], board: [] })
    expect(healed.meta).toBeTruthy()
    expect(typeof healed.meta.updatedAt).toBe('string')
  })

  it('does not mutate the input object', () => {
    const file = createDefaultData()
    const snapshot = JSON.stringify(file)
    validateAndHealData(file)
    expect(JSON.stringify(file)).toBe(snapshot)
  })

  it('caps logs at 500 without touching updatedAt', () => {
    const file = createDefaultData()
    file.meta.updatedAt = FIXED_TS
    file.logs = Array.from({ length: 600 }, (_, i) => ({ id: `log-${i}` }))
    const healed = validateAndHealData(file)
    expect(healed.logs).toHaveLength(500)
    expect(healed.logs[0].id).toBe('log-100') // newest 500 kept
    expect(healed.meta.updatedAt).toBe(FIXED_TS)
  })

  it('drops workingOn ids whose tasks vanished or completed, preserving updatedAt', () => {
    const file = createDefaultData()
    file.meta.updatedAt = FIXED_TS
    file.tasks = [
      { id: 't1', text: 'keep' },
      { id: 't2', text: 'done', completion: { completedDate: '2026-08-01' } }
    ]
    file.workingOn = ['t1', 't2', 'ghost']
    const healed = validateAndHealData(file)
    expect(healed.workingOn).toEqual(['t1'])
    expect(healed.meta.updatedAt).toBe(FIXED_TS)
  })
})
