import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionActionApp from '../SelectionActionApp'

// Cut the heavy content import graph (ActionWindow drags the chat render chain);
// the wiring under test is the boundary around the providers.
vi.mock('../ActionWindow', () => ({ default: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

describe('SelectionActionApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<SelectionActionApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })
})
