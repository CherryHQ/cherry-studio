// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CharCount, Input } from '../textarea'

afterEach(() => {
  cleanup()
})

describe('Textarea direction', () => {
  it('uses automatic direction by default', () => {
    render(<Input aria-label="Message" />)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('dir', 'auto')
  })

  it('respects an explicit direction override', () => {
    render(<Input aria-label="Technical content" dir="ltr" />)
    expect(screen.getByRole('textbox', { name: 'Technical content' })).toHaveAttribute('dir', 'ltr')
  })

  it('places the character count at logical end', () => {
    const { container } = render(<CharCount value="Hello" maxLength={10} />)
    expect(container.firstElementChild).toHaveClass('end-2')
  })
})
