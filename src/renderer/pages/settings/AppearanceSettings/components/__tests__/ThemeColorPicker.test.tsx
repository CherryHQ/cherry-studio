// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThemeColorPicker, { normalizeHexColor } from '../ThemeColorPicker'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const translations: Record<string, string> = {
  'settings.theme.color_picker.eyedropper': 'Localized eyedropper',
  'settings.theme.color_picker.hex': 'Localized hex color',
  'settings.theme.color_picker.hue': 'Localized hue',
  'settings.theme.color_picker.selection': 'Localized color plane'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key
  })
}))

beforeEach(() => {
  Object.defineProperty(window, 'EyeDropper', { configurable: true, value: class {} })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'EyeDropper')
})

describe('ThemeColorPicker', () => {
  it('normalizes shorthand hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')
    expect(normalizeHexColor('09f')).toBe('#0099FF')
  })

  it('opens the shared color picker instead of a native color input', () => {
    render(<ThemeColorPicker value="#112233" presets={[]} onChange={vi.fn()} ariaLabel="Theme color" />)

    expect(screen.queryByLabelText('Theme color', { selector: 'input[type="color"]' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theme color' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Localized hex color' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Theme color' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Theme color' }))

    expect(screen.getByRole('slider', { name: 'Localized color plane' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Localized hue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Localized eyedropper' })).toBeInTheDocument()
  })

  it('uses the swatch hover surface for keyboard focus without an outer ring', () => {
    render(<ThemeColorPicker value="#112233" presets={[]} onChange={vi.fn()} ariaLabel="Theme color" />)

    const trigger = screen.getByRole('button', { name: 'Theme color' })
    expect(trigger).toHaveClass('hover:bg-accent', 'focus-visible:bg-accent')
    expect(trigger).not.toHaveClass('focus-visible:ring-2')
  })

  it('reverts an invalid draft color on blur', () => {
    const onChange = vi.fn()

    render(<ThemeColorPicker value="#112233" presets={[]} onChange={onChange} ariaLabel="Theme color" />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'not-a-color' } })

    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('not-a-color')

    fireEvent.blur(input)

    expect(input).toHaveValue('#112233')
  })

  it('normalizes draft colors only after blur', () => {
    const onChange = vi.fn()

    const ControlledThemeColorPicker = () => {
      const [value, setValue] = useState('#112233')

      return (
        <ThemeColorPicker
          value={value}
          presets={[]}
          onChange={(nextValue) => {
            onChange(nextValue)
            setValue(nextValue)
          }}
          ariaLabel="Theme color"
        />
      )
    }

    render(<ControlledThemeColorPicker />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'BDE' } })

    expect(input).toHaveValue('BDE')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(input).toHaveValue('#BBDDEE')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#BBDDEE')
  })

  it('does not commit when the normalized draft matches the current value', () => {
    const onChange = vi.fn()

    render(<ThemeColorPicker value="#112233" presets={[]} onChange={onChange} ariaLabel="Theme color" />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '112233' } })

    expect(input).toHaveValue('112233')

    fireEvent.blur(input)

    expect(input).toHaveValue('#112233')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps consecutive picker adjustments relative to the latest draft', () => {
    const onChange = vi.fn()

    render(<ThemeColorPicker value="#112233" presets={[]} onChange={onChange} ariaLabel="Theme color" />)
    fireEvent.click(screen.getByRole('button', { name: 'Theme color' }))

    const hue = screen.getByRole('slider', { name: 'Localized hue' })
    fireEvent.keyDown(hue, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(hue, { key: 'ArrowRight', shiftKey: true })

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1][0]).not.toBe(onChange.mock.calls[0][0])
  })
})
