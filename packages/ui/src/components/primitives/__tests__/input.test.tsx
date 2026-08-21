// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from '../input'

describe('Input', () => {
  it('changes its own border on focus without drawing an outer ring', () => {
    render(<Input aria-label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input.className).toContain('focus-visible:border-primary')
    expect(input.className).not.toMatch(/focus-visible:ring-(?!0)/)
    expect(input.className).not.toContain('focus-visible:outline-')
  })
})
