import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionToolbarApp from '../SelectionToolbarApp'

// Cut the content import graph; the wiring under test is the boundary around
// the provider.
vi.mock('../SelectionToolbar', () => ({ default: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

describe('SelectionToolbarApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<SelectionToolbarApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })
})
