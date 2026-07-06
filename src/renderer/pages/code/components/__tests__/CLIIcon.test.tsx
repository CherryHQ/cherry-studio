import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CLIIcon } from '../CLIIcon'

describe('CLIIcon', () => {
  // The fallback branch (unknown icon id) must not interpolate a literal "undefined" into the class
  // list when the optional className is omitted.
  it('does not render a literal "undefined" class when className is omitted', () => {
    const { container } = render(<CLIIcon id="__unknown_tool__" />)
    const fallback = container.querySelector('div')

    expect(fallback).not.toBeNull()
    expect(fallback?.className).not.toContain('undefined')
    expect(fallback?.textContent).toBe('_')
  })
})
