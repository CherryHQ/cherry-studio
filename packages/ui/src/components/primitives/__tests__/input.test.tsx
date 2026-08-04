// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from '../input'

describe('Input', () => {
  it('uses the compact v2 shape and a subtle keyboard focus ring', () => {
    render(<Input aria-label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveClass('h-8', 'rounded-lg', 'px-2.5')
    expect(input.className).toContain('focus-visible:border-ring')
    expect(input.className).toContain('focus-visible:ring-1')
    expect(input.className).not.toContain('focus-visible:outline-')
  })
})
