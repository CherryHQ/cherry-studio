import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubWindowApp from '../SubWindowApp'

// Cut the heavy shell import graph (SubWindowAppShell → TabRouter → routeTree.gen);
// the wiring under test is the boundary around the providers.
vi.mock('../SubWindowAppShell', () => ({ SubWindowAppShell: () => null }))

const mocks = vi.hoisted(() => ({ registerPopup: vi.fn(), throwThemeError: true }))

vi.mock('../../ModelServiceSetupPopup', () => ({
  registerModelServiceSetupPopup: () => mocks.registerPopup()
}))
vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/components/CodeStyleProvider', () => ({
  CodeStyleProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@renderer/components/command', () => ({
  CommandContextKeyProvider: ({ children }: { children: ReactNode }) => children,
  CommandProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@renderer/components/ConversationNotificationRuntime', () => ({ ConversationNotificationRuntime: () => null }))
vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => {
    if (mocks.throwThemeError) throw new Error('theme provider boom')
    return children
  }
}))

describe('SubWindowApp top-level error boundary', () => {
  beforeEach(() => {
    mocks.throwThemeError = true
    mocks.registerPopup.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    render(<SubWindowApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })

  it('registers model service setup in detached chat windows', () => {
    const unregister = vi.fn()
    mocks.throwThemeError = false
    mocks.registerPopup.mockReturnValue(unregister)

    const view = render(<SubWindowApp />)

    expect(mocks.registerPopup).toHaveBeenCalledOnce()
    view.unmount()
    expect(unregister).toHaveBeenCalledOnce()
  })
})
