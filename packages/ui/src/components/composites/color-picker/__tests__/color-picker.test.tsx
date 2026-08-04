// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { ColorPicker, ColorPickerAlpha, ColorPickerHue, ColorPickerSelection } from '../color-picker'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('ColorPicker', () => {
  it('falls back instead of throwing on an undefined or invalid value', () => {
    expect(() => render(<ColorPicker />)).not.toThrow()
    expect(() => render(<ColorPicker value="not-a-color" />)).not.toThrow()
    expect(() => render(<ColorPicker value="#zzz" />)).not.toThrow()
  })

  it('does not fire onChange on mount or controlled value updates', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ColorPicker value="#3366ff" onChange={onChange} />)
    rerender(<ColorPicker value="#22aa55" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resyncs when the parent rejects a controlled change', () => {
    const onChange = vi.fn()
    render(
      <ColorPicker value="#3366ff" onChange={onChange}>
        <ColorPickerSelection />
      </ColorPicker>
    )
    const selection = screen.getByRole('slider', { name: 'Color saturation and brightness' })
    const initialSaturation = selection.getAttribute('aria-valuenow')

    fireEvent.keyDown(selection, { key: 'ArrowLeft', shiftKey: true })

    expect(onChange).toHaveBeenCalledOnce()
    expect(selection.getAttribute('aria-valuenow')).toBe(initialSaturation)
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

    fireEvent(selection, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 0 }))

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([255, 128, 128, 1]))
  })

  it('labels the interactive hue and alpha sliders', () => {
    render(
      <ColorPicker>
        <ColorPickerHue aria-label="Localized hue" />
        <ColorPickerAlpha aria-label="Localized alpha" />
      </ColorPicker>
    )

    expect(screen.getByRole('slider', { name: 'Localized hue' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Localized alpha' })).toBeTruthy()
  })
})
