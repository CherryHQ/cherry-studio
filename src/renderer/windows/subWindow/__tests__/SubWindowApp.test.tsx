import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubWindowApp from '../SubWindowApp'

// Cut the heavy shell import graph (SubWindowAppShell → TabRouter → routeTree.gen);
// the wiring under test is the boundary around the providers.
vi.mock('../SubWindowAppShell', () => ({ SubWindowAppShell: () => null }))
vi.mock('@renderer/hooks/useAppInit', () => ({ useAppInit: () => {} }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

describe('SubWindowApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<SubWindowApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })
})
