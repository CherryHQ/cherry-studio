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

  // The props are a closed set, so `FormControl`'s id silently vanished and
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

  // An affix used to swap the input for a nameless div that carried the tab
  // stop, leaving the labelled control unreachable.
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

  // The placeholder is prose, not a value: decorating it rendered
  // "Follow global (80%)%" on an empty three-state field.
  it('does not decorate the placeholder with prefix/suffix', () => {
    render(<EditableNumber value={null} prefix="$ " suffix="%" placeholder="Follow global (80%)" aria-label="P" />)

    expect(screen.getByText('Follow global (80%)')).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).toBeNull()
    expect(screen.queryByText(/^\$/)).toBeNull()
  })

  it('still decorates a real value of zero', () => {
    render(<EditableNumber value={0} suffix="%" placeholder="Follow global" aria-label="P" />)

    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })
})
