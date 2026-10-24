import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimeOfDayInput, fromTimeOfDay, toTimeOfDay } from '../TimeOfDayInput'

describe('toTimeOfDay / fromTimeOfDay', () => {
  it('round-trips minutes through the HH:mm form', () => {
    for (const minutes of [0, 1, 30, 60, 18 * 60, 23 * 60 + 59]) {
      expect(fromTimeOfDay(toTimeOfDay(minutes))).toBe(minutes)
    }
  })

  it('renders no value for an unset anchor', () => {
    expect(toTimeOfDay(null)).toBe('')
  })

  it('ignores an incomplete or out-of-range time', () => {
    expect(fromTimeOfDay('')).toBeNull()
    expect(fromTimeOfDay('18')).toBeNull()
    expect(fromTimeOfDay('18:')).toBeNull()
    expect(fromTimeOfDay('24:00')).toBeNull()
    expect(fromTimeOfDay('12:60')).toBeNull()
  })
})

describe('TimeOfDayInput', () => {
  afterEach(() => cleanup())

  it('shows the stored time', () => {
    render(<TimeOfDayInput value={18 * 60} onChange={vi.fn()} aria-label="First Backup Time" />)
    expect(screen.getByLabelText('First Backup Time')).toHaveValue('18:00')
  })

  it('publishes a complete time and keeps half-typed text local', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimeOfDayInput value={null} onChange={onChange} aria-label="First Backup Time" />)

    const input = screen.getByLabelText('First Backup Time')
    await user.type(input, '0730')
    // The browser only yields a value once both segments are filled.
    expect(onChange).toHaveBeenLastCalledWith(7 * 60 + 30)
    expect(onChange).not.toHaveBeenCalledWith(null)
  })

  it('clears the anchor when the field is emptied and blurred', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimeOfDayInput value={18 * 60} onChange={onChange} aria-label="First Backup Time" />)

    const input = screen.getByLabelText('First Backup Time')
    await user.clear(input)
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('does not clear the anchor on blur when a time is present', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimeOfDayInput value={18 * 60} onChange={onChange} aria-label="First Backup Time" />)

    await user.click(screen.getByLabelText('First Backup Time'))
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('is disabled when the caller disables it', () => {
    render(<TimeOfDayInput value={null} onChange={vi.fn()} disabled aria-label="First Backup Time" />)
    expect(screen.getByLabelText('First Backup Time')).toBeDisabled()
  })
})
