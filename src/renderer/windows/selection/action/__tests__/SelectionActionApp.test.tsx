import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebSearchFallbackNotice } from '@renderer/hooks/useWebSearchFallbackNotice'

import SelectionActionApp from '../SelectionActionApp'

const state = vi.hoisted(() => ({ allowTheme: false }))

vi.mock('@renderer/hooks/useWebSearchFallbackNotice', () => ({ useWebSearchFallbackNotice: vi.fn() }))
vi.mock('@renderer/components/CodeStyleProvider', () => ({
  CodeStyleProvider: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/components/VoicePlaybackHost', () => ({ VoicePlaybackHost: () => null }))

// Cut the heavy content import graph (ActionWindow drags the chat render chain);
// the wiring under test is the boundary around the providers.
vi.mock('../ActionWindow', () => ({ default: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => {
    if (state.allowTheme) return children
    throw new Error('theme provider boom')
  }
}))

describe('SelectionActionApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    state.allowTheme = false
    vi.restoreAllMocks()
  })

  it('mounts the web search fallback notice listener', () => {
    state.allowTheme = true
    render(<SelectionActionApp />)

    expect(useWebSearchFallbackNotice).toHaveBeenCalledOnce()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<SelectionActionApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })
})
