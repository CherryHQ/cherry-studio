import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantApp from '../QuickAssistantApp'

// Cut the heavy content import graph; the wiring under test is the boundary
// around the providers. The pre-existing INNER ErrorBoundary sits inside
// ThemeProvider/CodeStyleProvider and cannot catch this throw.
vi.mock('../home/HomeWindow', () => ({ default: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

describe('QuickAssistantApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<QuickAssistantApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })
})
