import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from '../App'

afterEach(cleanup)

// Phase 2 regression: a habit.json with numeric schemaVersion > 1 must be
// REFUSED (never healed downgraded) with a clear error screen.

function mockApi({ dataPath = 'C:\\fake\\habit.json', loadData } = {}) {
  window.api = {
    getAppState: vi.fn(async () => ({ dataPath })),
    loadData: vi.fn(loadData),
    saveData: vi.fn(async () => {}),
    getWatcherEnabled: vi.fn(async () => true),
    setWatcherEnabled: vi.fn(async () => {}),
    setAppState: vi.fn(async () => {}),
    checkConflicts: vi.fn(async () => []),
    onExternalChange: vi.fn(() => () => {}),
    refreshData: vi.fn(async () => null),
    backupNow: vi.fn(async () => 'x'),
    openDataFolder: vi.fn(async () => {}),
    moveDataToFolder: vi.fn(async () => ({})),
    getDefaultPath: vi.fn(async () => dataPath)
  }
  return window.api
}

describe('App schemaVersion refusal (Phase 2)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('shows the newer-version screen and never heals the file', async () => {
    const api = mockApi({
      loadData: async () => ({ schemaVersion: 2, tasks: [{ id: 'x', text: 'future task' }] })
    })
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Data file is from a newer version')).toBeInTheDocument()
    })
    expect(screen.getByText(/schemaVersion 2/)).toBeInTheDocument()
    expect(screen.getByText(/The file was not modified/)).toBeInTheDocument()
    // CRITICAL: a refused file must not be saved back (healed-downgraded)
    expect(api.saveData).not.toHaveBeenCalled()
  })

  it('treats missing schemaVersion as 1 and renders the Today page', async () => {
    mockApi({
      loadData: async () => ({
        meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        settings: { theme: 'dark' },
        difficulties: [{ id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true }],
        categories: [],
        markers: [],
        board: [],
        tasks: []
      })
    })
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByText('Data file is from a newer version')).not.toBeInTheDocument()
    })
    // Today view is the default (nav button + empty state both present)
    await waitFor(() => {
      expect(screen.getAllByText('Today').length).toBeGreaterThan(0)
    })
  })
})
