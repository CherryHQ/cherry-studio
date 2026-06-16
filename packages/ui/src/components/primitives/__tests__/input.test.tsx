// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '../input'

afterEach(() => {
  cleanup()
})

describe('Input density', () => {
  it('renders h-9 by default', () => {
    render(<Input data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('h-9', 'px-3')
  })

  it('renders h-8 + px-2.5 when density=compact', () => {
    render(<Input data-testid="input" density="compact" />)
    const input = screen.getByTestId('input')
    expect(input).toHaveClass('h-8', 'px-2.5', 'text-sm')
    expect(input).not.toHaveClass('h-9')
  })
})
