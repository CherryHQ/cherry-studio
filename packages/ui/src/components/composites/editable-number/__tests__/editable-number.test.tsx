// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EditableNumber from '../index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditableNumber', () => {
  it('clamps and rounds committed values', () => {
    const onChange = vi.fn()

    render(<EditableNumber value={1} min={0} max={10} precision={1} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20.24' } })

    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('defers changes until blur when changeOnBlur is enabled', () => {
    const onChange = vi.fn()

    render(<EditableNumber value={1} precision={1} changeOnBlur onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '2.26' } })

    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(2.3)
  })

  it('reverts the draft value with Escape', () => {
    const onChange = vi.fn()

    render(<EditableNumber value={4} changeOnBlur onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue(4)
    expect(onChange).not.toHaveBeenCalled()
  })

  // The props are a closed set — anything not listed never reaches the DOM, so
  // `FormControl`'s id (paired with `FormLabel htmlFor`) silently vanished and
  // every field built this way had an unnamed input.
  it('forwards id and aria attributes so the input can be named', () => {
    render(
      <>
        <label htmlFor="ctx-form-item">Recent messages kept</label>
        <EditableNumber value={5} id="ctx-form-item" aria-describedby="ctx-hint" aria-invalid />
      </>
    )

    expect(screen.getByLabelText('Recent messages kept')).toBe(screen.getByRole('spinbutton'))
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-describedby', 'ctx-hint')
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true')
  })

  it('names a standalone field through aria-label', () => {
    render(<EditableNumber value={5} aria-label="Tool-output truncation threshold" />)

    expect(screen.getByLabelText('Tool-output truncation threshold')).toBe(screen.getByRole('spinbutton'))
  })

  // A formatter/prefix/suffix used to swap the input for a presentational div
  // that carried the tab stop but no role, id or name — so the labelled control
  // was unreachable and `FormLabel`'s htmlFor pointed at a hidden element.
  it.each([
    ['formatter', { formatter: (v: number | null) => `${v ?? 0} rounds` }],
    ['suffix', { suffix: ' chars' }],
    ['prefix', { prefix: '≤ ' }]
  ])('keeps the input as the only named, focusable control with a %s', (_label, props) => {
    render(
      <>
        <label htmlFor="affixed">Max tool call rounds</label>
        <EditableNumber value={20} id="affixed" {...props} />
      </>
    )

    const input = screen.getByRole('spinbutton')
    expect(screen.getByLabelText('Max tool call rounds')).toBe(input)
    // The overlay is decoration: hidden from the accessibility tree entirely.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    input.focus()
    expect(input).toHaveFocus()
  })

  it('shows the formatted overlay until the field is focused', () => {
    render(<EditableNumber value={20} suffix=" rounds" aria-label="Rounds" />)

    expect(screen.getByText(/rounds/)).toBeInTheDocument()
    fireEvent.focus(screen.getByRole('spinbutton'))
    expect(screen.queryByText(/rounds/)).not.toBeInTheDocument()
  })
})
