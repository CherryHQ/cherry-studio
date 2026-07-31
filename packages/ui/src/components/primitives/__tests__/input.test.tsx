// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '../input'

afterEach(cleanup)

describe('Input density', () => {
  it('preserves the standard default size', () => {
    render(<Input aria-label="Name" />)

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-size', 'default')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('h-9', 'px-3', 'text-sm')
  })

  it('applies an explicit compact size', () => {
    render(<Input aria-label="Name" size="sm" />)

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('data-size', 'sm')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('h-8', 'px-2.5', 'text-xs')
  })
})
