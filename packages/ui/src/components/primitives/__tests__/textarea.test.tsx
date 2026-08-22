// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input as Textarea } from '../textarea'

afterEach(cleanup)

describe('Textarea density', () => {
  it('preserves the standard default density', () => {
    render(<Textarea aria-label="Description" />)

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('data-size', 'default')
  })

  it('applies an explicit compact density', () => {
    render(<Textarea aria-label="Description" size="sm" />)

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('data-size', 'sm')
  })
})
