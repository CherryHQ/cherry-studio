// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
})
