// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '../input'

afterEach(() => {
  cleanup()
})

describe('Input direction', () => {
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
