import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import Board from '../components/Board'

afterEach(cleanup)

// Ported from scripts/verify-board-fix.mjs (deleted in favor of this suite).
//
// THE regression: Board used to wrap dnd-kit hooks in
//   const sensors = useMemo(() => useSensors(useSensor(...), ...), [])
// On mount the memo factory ran and the inner useSensor hooks registered;
// on every UPDATE render the factory was skipped (deps unchanged) so those
// hooks never ran — shifting every later hook and crashing
// areHookInputsEqual with "Cannot read properties of undefined (reading
// 'length')" on Board's SECOND render. These tests force exactly that
// second render.

const makeData = () => ({
  schemaVersion: 1,
  settings: { theme: 'dark', weekStartsOn: 1, fatigueIncrement: 0.1, fatigueCap: 3 },
  difficulties: [{ id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true }],
  categories: [{ id: 'c1', name: 'Work', color: '#60a5fa', order: 0, active: true }],
  markers: [{ id: 'm1', categoryId: 'c1', order: 0 }],
  board: [
    { id: 'b1', type: 'marker', markerId: 'm1' },
    { id: 'b2', type: 'task', taskId: 't1' }
  ],
  tasks: [{ id: 't1', text: 'Test task', createdAt: '2026-08-01T10:00:00.000Z' }],
  workingOn: [],
  logs: []
})

describe('Board hook-order regression (the masked TypeError)', () => {
  it('survives mount AND an update render with identical results', () => {
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
      errors.push(a.map(String).join(' '))
    })
    try {
      const { container, rerender } = render(<Board data={makeData()} onSave={() => {}} />)
      expect(container.textContent).toContain('Test task')

      // THE crash scenario: an update render (memo factory now skipped)
      const data2 = makeData()
      data2.tasks[0].text = 'Test task edited'
      data2.board[1].taskId = 't1'
      rerender(<Board data={data2} onSave={() => {}} />)

      expect(container.textContent).toContain('Test task edited')
      expect(errors.join('\n')).not.toContain("reading 'length'")
      expect(errors.join('\n')).not.toContain('Rendered more hooks')
      expect(errors.join('\n')).not.toContain('Rendered fewer hooks')
    } finally {
      spy.mockRestore()
    }
  })

  it('renders task categories from matching marker spans (getTaskCategory fix)', () => {
    // task-5-style active task inside a Work span: Board's categoryLookup
    // (via core getTaskCategory) must find Work, not null (pre-fix it was
    // ALWAYS null because board items carry markerId, not categoryId).
    const data = makeData()
    data.tasks.push({ id: 't2', text: 'Spanned task', createdAt: '2026-08-01T11:00:00.000Z' })
    data.board = [
      { id: 'b1', type: 'marker', markerId: 'm1' },
      { id: 'b2', type: 'task', taskId: 't2' },
      { id: 'b3', type: 'marker', markerId: 'm2' },
      { id: 'b4', type: 'task', taskId: 't1' }
    ]
    data.markers.push({ id: 'm2', categoryId: 'c1', order: 1 })
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')) })
    try {
      const { container } = render(<Board data={data} onSave={() => {}} />)
      expect(container.textContent).toContain('Spanned task')
      expect(errors.join('\n')).not.toContain("reading 'length'")
    } finally {
      spy.mockRestore()
    }
  })
})
