// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ColorPicker } from '../index'

describe('ColorPicker', () => {
  it('falls back instead of throwing on an undefined or invalid value (safeColor)', () => {
    expect(() => render(<ColorPicker />)).not.toThrow()
    expect(() => render(<ColorPicker value="not-a-color" />)).not.toThrow()
    expect(() => render(<ColorPicker value="#zzz" />)).not.toThrow()
  })

  it('does not fire onChange on mount when controlled (shouldNotify gate)', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="#3366ff" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not fire onChange when the controlled value is re-fed (no round-trip)', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ColorPicker value="#3366ff" onChange={onChange} />)
    rerender(<ColorPicker value="#22aa55" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })
})
