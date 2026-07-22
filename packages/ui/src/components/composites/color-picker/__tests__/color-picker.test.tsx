// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ColorPicker, ColorPickerSelection } from '../index'

describe('ColorPicker', () => {
  it('falls back instead of throwing on an undefined or invalid value (safeColor)', () => {
    expect(() => render(<ColorPicker />)).not.toThrow()
    expect(() => render(<ColorPicker value="not-a-color" />)).not.toThrow()
    expect(() => render(<ColorPicker value="#zzz" />)).not.toThrow()
  })

  it('does not fire onChange on mount when controlled', () => {
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

  it('resyncs to the controlled value when the parent rejects the change', () => {
    const onChange = vi.fn()
    render(
      <ColorPicker value="#3366ff" onChange={onChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })
    const initialSaturation = selection.getAttribute('aria-valuenow')

    // ArrowLeft nudges saturation down; the parent keeps value unchanged (rejection)
    fireEvent.keyDown(selection, { key: 'ArrowLeft', shiftKey: true })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(selection.getAttribute('aria-valuenow')).toBe(initialSaturation)
  })

  it('syncs to a later (debounced) value commit even when onChange already fired', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorPicker value="#3366ff" onChange={onChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })
    const initialSaturation = selection.getAttribute('aria-valuenow')
    const initialValueText = selection.getAttribute('aria-valuetext')

    // Debounced parent: onChange fires but the value prop stays put for now
    fireEvent.keyDown(selection, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(selection.getAttribute('aria-valuenow')).toBe(initialSaturation)

    // The debounce later commits a new value: the picker must adopt it
    rerender(
      <ColorPicker value="#22aa55" onChange={onChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    expect(selection.getAttribute('aria-valuetext')).not.toBe(initialValueText)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('follows the interaction when the parent accepts the change', () => {
    const Harness = () => {
      const [color, setColor] = useState('#3366ff')
      return (
        <ColorPicker value={color} onChange={([r, g, b, a]) => setColor(`rgba(${r}, ${g}, ${b}, ${a})`)}>
          <ColorPickerSelection />
        </ColorPicker>
      )
    }
    render(<Harness />)
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })
    const initialSaturation = Number(selection.getAttribute('aria-valuenow'))

    fireEvent.keyDown(selection, { key: 'ArrowLeft', shiftKey: true })

    expect(Number(selection.getAttribute('aria-valuenow'))).toBeLessThan(initialSaturation)
  })

  it('maps the visible HSV plane to the emitted color', async () => {
    const onChange = vi.fn()
    render(
      <ColorPicker defaultValue="#ff0000" onChange={onChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })
    vi.spyOn(selection, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    fireEvent(
      selection,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0
      })
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([255, 128, 128, 1])
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not retain a notification after a boundary no-op', () => {
    const initialOnChange = vi.fn()
    const nextOnChange = vi.fn()
    const { rerender } = render(
      <ColorPicker value="#000000" onChange={initialOnChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })

    fireEvent.keyDown(selection, { key: 'ArrowLeft' })
    expect(initialOnChange).not.toHaveBeenCalled()

    rerender(
      <ColorPicker value="#000000" onChange={nextOnChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )

    expect(nextOnChange).not.toHaveBeenCalled()
  })
})
