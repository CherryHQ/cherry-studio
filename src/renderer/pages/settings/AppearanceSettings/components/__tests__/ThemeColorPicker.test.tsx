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

  it('opens the v2 color picker instead of a native color input', () => {
    render(<ThemeColorPicker value="#112233" presets={[]} onChange={vi.fn()} ariaLabel="Theme color" />)

    expect(screen.queryByLabelText('Theme color', { selector: 'input[type="color"]' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Theme color' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Theme color' }))

    expect(screen.getByRole('slider', { name: 'Localized color plane' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Localized hue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Localized eyedropper' })).toBeInTheDocument()
  })

  it('matches the one-pixel focus ring used by inputs and selects', () => {
    render(<ThemeColorPicker value="#112233" presets={['#112233']} onChange={vi.fn()} ariaLabel="Theme color" />)

    expect(screen.getByRole('button', { name: '#112233' })).toHaveClass(
      'focus-visible:ring-[1px]',
      'focus-visible:ring-ring/35'
    )
    expect(screen.getByRole('button', { name: 'Theme color' })).toHaveClass(
      'focus-visible:ring-[1px]',
      'focus-visible:ring-ring/35'
    )
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
})
