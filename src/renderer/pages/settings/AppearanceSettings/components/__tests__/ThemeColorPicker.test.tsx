// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ThemeColorPicker, { normalizeHexColor } from '../ThemeColorPicker'

afterEach(() => {
  cleanup()
})

describe('ThemeColorPicker', () => {
  it('normalizes shorthand hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC')
    expect(normalizeHexColor('09f')).toBe('#0099FF')
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
