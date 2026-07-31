import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CliIcon } from '../CliIcon'

describe('CliIcon', () => {
  it('renders a fallback initial for unknown tools', () => {
    const { container } = render(<CliIcon id="__unknown_tool__" />)
    const fallback = container.querySelector('div')

    expect(fallback).not.toBeNull()
    expect(fallback?.textContent).toBe('_')
  })
})
