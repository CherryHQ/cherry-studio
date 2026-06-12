// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Field, FieldContent } from '../field'

afterEach(() => {
  cleanup()
})

describe('Field density', () => {
  it('applies default gap when density is omitted', () => {
    render(<Field data-testid="field" />)
    expect(screen.getByTestId('field')).toHaveClass('gap-3')
  })

  it('applies compact gap when density=compact', () => {
    render(<Field data-testid="field" density="compact" />)
    const field = screen.getByTestId('field')
    expect(field).toHaveClass('gap-2')
    expect(field).not.toHaveClass('gap-3')
  })
})

describe('FieldContent density', () => {
  it('applies default gap when density is omitted', () => {
    render(<FieldContent data-testid="content" />)
    expect(screen.getByTestId('content')).toHaveClass('gap-1.5')
  })

  it('applies compact gap when density=compact', () => {
    render(<FieldContent data-testid="content" density="compact" />)
    const content = screen.getByTestId('content')
    expect(content).toHaveClass('gap-1')
    expect(content).not.toHaveClass('gap-1.5')
  })
})
