import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HabitEditor from '../components/HabitEditor'
import { createDefaultData } from '@habit-tracker/core'

afterEach(cleanup)

// THE feature this app exists for: a habit due several times a day gets ONE
// "best time of day" choice PER occurrence — brushing teeth twice a day can
// be Morning + Evening, drinking water three times can span the whole day.

function makeData() {
  const data = createDefaultData()
  return data
}

function openCreate(data) {
  render(
    <HabitEditor
      data={data}
      onSave={() => {}}
      onClose={() => {}}
      habit={null}
    />
  )
}

function clickMoreTimes(n) {
  const more = screen.getByLabelText('More times per day')
  for (let i = 0; i < n; i++) fireEvent.click(more)
}

describe('HabitEditor — multiple best-time-of-day choices', () => {
  it('shows one time-of-day picker per occurrence once per-day > 1', () => {
    openCreate(makeData())
    expect(screen.queryByTestId('slot-pickers')).not.toBeInTheDocument()
    clickMoreTimes(1) // 2× per day
    expect(screen.getByTestId('slot-pickers')).toBeInTheDocument()
    const pickerButtons = screen.getAllByLabelText(/Time [12] of 2:/i)
    expect(pickerButtons.length).toBeGreaterThanOrEqual(8) // 2 pickers × 5 options (4 slots + anytime) minus labels overlapping
    // Each picker offers all four slots plus Anytime.
    expect(screen.getAllByLabelText(/Time 1 of 2: Morning/i).length).toBe(1)
    expect(screen.getAllByLabelText(/Time 2 of 2: Evening/i).length).toBe(1)
    expect(screen.getAllByLabelText(/Time 1 of 2: Anytime/i).length).toBe(1)
  })

  it('suggests morning + evening for 2× per day and lets each be changed independently', () => {
    openCreate(makeData())
    clickMoreTimes(1)
    // Default suggestion: 1 → morning, 2 → evening (both picked).
    expect(screen.getAllByLabelText('Time 1 of 2: Morning')[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByLabelText('Time 2 of 2: Evening')[0]).toHaveAttribute('aria-pressed', 'true')
    // Change the second occurrence to Night.
    fireEvent.click(screen.getAllByLabelText('Time 2 of 2: Night')[0])
    expect(screen.getAllByLabelText('Time 2 of 2: Night')[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByLabelText('Time 2 of 2: Evening')[0]).toHaveAttribute('aria-pressed', 'false')
    // The first occurrence is untouched.
    expect(screen.getAllByLabelText('Time 1 of 2: Morning')[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('saves per-occurrence choices as timesOfDay on the habit', () => {
    const data = makeData()
    const onSave = vi.fn()
    render(
      <HabitEditor data={data} onSave={onSave} onClose={() => {}} habit={null} />
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rinse with mouthwash' } })
    clickMoreTimes(1)
    // Defaults: morning + evening — switch #2 to night for variety.
    fireEvent.click(screen.getAllByLabelText('Time 2 of 2: Night')[0])
    fireEvent.click(screen.getByText('Create habit'))

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0]
    const habit = saved.habits[saved.habits.length - 1]
    expect(habit.title).toBe('Rinse with mouthwash')
    expect(habit.timesPerDay).toBe(2)
    expect(habit.timesOfDay).toEqual(['morning', 'night'])
    // Board gains the habit row.
    expect(saved.board.some(item => item.type === 'habit' && item.habitId === habit.id)).toBe(true)
  })

  it('saves all-anytime occurrences as a slotless multi-per-day habit', () => {
    const data = makeData()
    const onSave = vi.fn()
    render(
      <HabitEditor data={data} onSave={onSave} onClose={() => {}} habit={null} />
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stretch break' } })
    clickMoreTimes(1)
    fireEvent.click(screen.getAllByLabelText('Time 1 of 2: Anytime')[0])
    fireEvent.click(screen.getAllByLabelText('Time 2 of 2: Anytime')[0])
    fireEvent.click(screen.getByText('Create habit'))

    const saved = onSave.mock.calls[0][0]
    const habit = saved.habits[saved.habits.length - 1]
    expect(habit.timesPerDay).toBe(2)
    expect(habit.timesOfDay).toBeUndefined() // no preferred times → slotless
  })

  it('edits an existing habit, preserving its id and history', () => {
    const data = makeData()
    const brush = data.habits.find(h => h.title === 'Brush teeth')
    const onSave = vi.fn()
    render(
      <HabitEditor data={data} onSave={onSave} onClose={() => {}} habit={brush} />
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Brush teeth')
    // Seeded: 2×/day, morning + evening.
    expect(screen.getAllByLabelText(/Time 1 of 2: Morning/i).length).toBeGreaterThan(0)
    // Bump to 3×/day → third picker appears.
    clickMoreTimes(1)
    expect(screen.getAllByLabelText(/Time 3 of 3/i).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Save changes'))

    const saved = onSave.mock.calls[0][0]
    const edited = saved.habits.find(h => h.id === brush.id)
    expect(edited.timesPerDay).toBe(3)
    expect(edited.id).toBe(brush.id)
    expect(saved.completions.length).toBe(data.completions.length) // history untouched
  })
})
