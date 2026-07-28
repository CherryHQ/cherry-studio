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
})
