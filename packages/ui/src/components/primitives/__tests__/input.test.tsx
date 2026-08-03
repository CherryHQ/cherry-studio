// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '../input'

afterEach(() => {
  cleanup()
})

describe('Input', () => {
  it('changes its own border on focus without drawing an outer ring', () => {
    render(<Input aria-label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input.className).toContain('focus-visible:border-primary')
    expect(input.className).not.toMatch(/focus-visible:ring-(?!0)/)
    expect(input.className).not.toContain('focus-visible:outline-')
  })

  it('uses automatic direction for natural-language text', () => {
    render(<Input aria-label="Prompt" />)
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute('dir', 'auto')
  })

  it('uses LTR for technical input types', () => {
    render(<Input aria-label="Email" type="email" />)
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('dir', 'ltr')
  })

  it('respects an explicit direction override', () => {
    render(<Input aria-label="Identifier" dir="ltr" />)
    expect(screen.getByRole('textbox', { name: 'Identifier' })).toHaveAttribute('dir', 'ltr')
  })
})
