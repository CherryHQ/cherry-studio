// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Input } from '../input'

describe('Input', () => {
  it('changes its own border on focus without drawing an outer ring', () => {
    render(<Input aria-label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input.className).toContain('focus-visible:border-primary')
    expect(input.className).not.toMatch(/focus-visible:ring-(?!0)/)
    expect(input.className).not.toContain('focus-visible:outline-')
  })

  it('drops focus when wheeled so a number field cannot silently spin its value', () => {
    const onWheel = vi.fn()
    render(<Input type="number" aria-label="Port" onWheel={onWheel} />)

    const input = screen.getByRole('spinbutton', { name: 'Port' })
    input.focus()
    const wheeled = fireEvent.wheel(input, { deltaY: 100 })

    expect(document.activeElement).not.toBe(input)
    expect(onWheel).toHaveBeenCalledOnce()
    // Not preventDefault'd — the surrounding scroll container must still scroll.
    expect(wheeled).toBe(true)
  })

  it('keeps focus when a non-number field is wheeled', () => {
    render(<Input type="text" aria-label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    input.focus()
    fireEvent.wheel(input, { deltaY: 100 })

    expect(document.activeElement).toBe(input)
  })
})
