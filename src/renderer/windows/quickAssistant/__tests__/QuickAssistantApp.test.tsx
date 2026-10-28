import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantApp from '../QuickAssistantApp'

// Cut the heavy content import graph; the wiring under test is the boundary
// around the providers. The pre-existing INNER ErrorBoundary sits inside
// ThemeProvider/CodeStyleProvider and cannot catch this throw.
vi.unmock('@cherrystudio/ui')

vi.mock('../QuickAssistantView', async () => {
  const { usePortalContainer } = await import('@cherrystudio/ui')
  return {
    default: function MockQuickAssistantView() {
      const container = usePortalContainer()
      if (!state.renderMenu) return null
      const menu = <div role="listbox" aria-label="Models" />
      return (
        <div aria-label="Composer controls" style={{ height: 40, overflow: 'hidden' }}>
          {container ? createPortal(menu, container) : menu}
        </div>
      )
    }
  }
})

const state = vi.hoisted(() => ({ throwTheme: true, renderMenu: false, renderVoicePlaybackHost: vi.fn() }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => {
    if (state.throwTheme) throw new Error('theme provider boom')
    return children
  }
}))

vi.mock('@renderer/components/CodeStyleProvider', () => ({
  CodeStyleProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/components/VoicePlaybackHost', () => ({
  VoicePlaybackHost: () => {
    state.renderVoicePlaybackHost()
    return <div aria-label="Voice playback" />
  }
}))
vi.mock('@renderer/hooks/useCustomCss', () => ({ useCustomCss: vi.fn() }))
vi.mock('@renderer/hooks/useLanguageSync', () => ({ useLanguageSync: vi.fn() }))

describe('QuickAssistantApp top-level error boundary', () => {
  beforeEach(() => {
    state.throwTheme = true
    state.renderMenu = false
    state.renderVoicePlaybackHost.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<QuickAssistantApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })

  it('mounts the shared playback host inside the quick-assistant providers', () => {
    state.throwTheme = false

    render(<QuickAssistantApp />)

    expect(screen.getByLabelText('Voice playback')).toBeInTheDocument()
    expect(state.renderVoicePlaybackHost).toHaveBeenCalledOnce()
  })

  it('renders menus outside the clipped composer toolbar', () => {
    state.throwTheme = false
    state.renderMenu = true

    render(<QuickAssistantApp />)

    const menu = screen.getByRole('listbox', { name: 'Models' })
    expect(screen.getByLabelText('Composer controls')).not.toContainElement(menu)
  })
})
