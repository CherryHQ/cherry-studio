// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '../textarea'

afterEach(() => {
  cleanup()
})

describe('TextareaInput', () => {
  it('auto-grows with its content via field-sizing-content', () => {
    // jsdom cannot lay out `field-sizing: content`; asserting the class is the
    // contract check that the auto-grow behavior is actually shipped.
    render(<Input defaultValue="long answer that should wrap and grow the field" />)

    expect(screen.getByDisplayValue('long answer that should wrap and grow the field')).toHaveClass(
      'field-sizing-content'
    )
  })

  it('keeps the auto-grow class when a consumer adds its own classes', () => {
    render(<Input className="resize-none" />)

    const field = screen.getByRole('textbox')
    expect(field).toHaveClass('field-sizing-content')
    expect(field).toHaveClass('resize-none')
  })
})
