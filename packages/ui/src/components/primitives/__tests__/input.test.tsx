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

  it('exposes the default density and an explicit compact density', () => {
    const { rerender } = render(<Input aria-label="Name" />)

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-size', 'default')

    rerender(<Input aria-label="Name" size="sm" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-size', 'sm')

    rerender(<Input aria-label="Name" size="lg" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-size', 'lg')
  })

  it('preserves the native numeric size attribute without changing control density', () => {
    render(<Input aria-label="Search width" size={12} />)

    expect(screen.getByRole('textbox', { name: 'Search width' })).toHaveAttribute('size', '12')
    expect(screen.getByRole('textbox', { name: 'Search width' })).toHaveAttribute('data-size', 'default')
  })
})
