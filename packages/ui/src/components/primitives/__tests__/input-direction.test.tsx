// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from '../input'
import { Input as TextareaInput } from '../textarea'

describe('text input direction', () => {
  it('defaults user-entered text to automatic direction detection', () => {
    render(
      <>
        <Input aria-label="name" />
        <TextareaInput aria-label="message" />
      </>
    )

    expect(screen.getByRole('textbox', { name: 'name' })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('textbox', { name: 'message' })).toHaveAttribute('dir', 'auto')
  })

  it('allows technical inputs to opt into LTR', () => {
    render(
      <>
        <Input aria-label="url" type="url" />
        <Input aria-label="identifier" dir="ltr" />
      </>
    )

    expect(screen.getByRole('textbox', { name: 'url' })).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('textbox', { name: 'identifier' })).toHaveAttribute('dir', 'ltr')
  })
})
