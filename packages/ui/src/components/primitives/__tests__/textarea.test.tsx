// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import * as Textarea from '../textarea'

afterEach(() => {
  cleanup()
})

describe('Textarea density', () => {
  it('renders min-h-16 by default', () => {
    render(<Textarea.Input data-testid="textarea" />)
    expect(screen.getByTestId('textarea')).toHaveClass('min-h-16')
  })

  it('renders min-h-12 + smaller padding when density=compact', () => {
    render(<Textarea.Input data-testid="textarea" density="compact" />)
    const textarea = screen.getByTestId('textarea')
    expect(textarea).toHaveClass('min-h-12', 'px-3', 'py-2', 'text-sm')
    expect(textarea).not.toHaveClass('min-h-16')
  })
})
