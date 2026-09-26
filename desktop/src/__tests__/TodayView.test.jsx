import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import TodayView from '../components/TodayView'
import { createDefaultData } from '@habit-tracker/core'

afterEach(cleanup)

// The Today page groups what should be done TODAY by time of day. A habit
// with per-occurrence "best time of day" choices (brushing twice a day =
// Morning + Evening) gets ONE row per occurrence, each independently
// checkable and undoable.

function todayYmd() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function makeData() {
  const data = createDefaultData()
  // Deterministic today, no seeded history for today itself (skip chance).
  return data
}

describe('TodayView (main page)', () => {
  it('renders the greeting and slot sections for seeded slotted habits', () => {
    render(<TodayView data={makeData()} onSave={() => {}} onEditHabit={() => {}} onAddHabit={() => {}} />)
    // Section headers: Morning / Afternoon / Evening (+ Anytime).
    expect(screen.getAllByText('Morning').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Evening').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Brush teeth').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Drink water').length).toBeGreaterThanOrEqual(1)
  })

  it('shows a per-slot check button for every occurrence of a multi-per-day habit', () => {
    const data = makeData()
    render(<TodayView data={data} onSave={() => {}} onEditHabit={() => {}} onAddHabit={() => {}} />)
    // Brush teeth = 2 occurrences (morning + evening) → two slot buttons.
    const brushButtons = screen.getAllByLabelText(/brush teeth/i)
    expect(brushButtons.length).toBe(2)
    // Drink water = 3 occurrences (morning/afternoon/evening) → three.
    const waterButtons = screen.getAllByLabelText(/drink water/i)
    expect(waterButtons.length).toBe(3)
  })

  it('checking a slot saves a slot-tagged completion; undo removes it', () => {
    const data = makeData()
    const onSave = vi.fn()
    render(<TodayView data={data} onSave={onSave} onEditHabit={() => {}} onAddHabit={() => {}} />)

    const morningBrush = screen.getAllByLabelText(/brush teeth \(morning\)/i)[0]
    expect(morningBrush.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(morningBrush)

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0]
    const today = todayYmd()
    const brush = saved.habits.find(h => h.title === 'Brush teeth')
    const added = saved.completions.filter(c => c.habitId === brush.id && c.date === today)
    expect(added).toHaveLength(1)
    expect(added[0].slot).toBe('morning')

    // Undo path: same toggle with the completion present removes it.
    const onSave2 = vi.fn()
    cleanup()
    const data2 = {
      ...data,
      completions: [...data.completions, added[0]]
    }
    render(<TodayView data={data2} onSave={onSave2} onEditHabit={() => {}} onAddHabit={() => {}} />)
    const morningBrush2 = screen.getAllByLabelText(/brush teeth \(morning\)/i)[0]
    expect(morningBrush2.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(morningBrush2)
    expect(onSave2).toHaveBeenCalledTimes(1)
    const saved2 = onSave2.mock.calls[0][0]
    expect(
      saved2.completions.filter(c => c.id === added[0].id)
    ).toHaveLength(0)
  })

  it('shows the empty state when there are no habits', () => {
    render(
      <TodayView
        data={{ habits: [], completions: [], frequencies: [], board: [], settings: {} }}
        onSave={() => {}}
        onEditHabit={() => {}}
        onAddHabit={() => {}}
      />
    )
    expect(screen.getByText('Nothing tracked yet')).toBeInTheDocument()
  })
})
