import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubWindowApp from '../SubWindowApp'

const mocks = vi.hoisted(() => ({
  themeProviderThrows: true,
  useAutoBackupEvents: vi.fn()
}))

// Cut the heavy shell import graph (SubWindowAppShell → TabRouter → routeTree.gen);
// the wiring under test is the boundary around the providers.
vi.mock('../SubWindowAppShell', () => ({ SubWindowAppShell: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => {
    if (mocks.themeProviderThrows) throw new Error('theme provider boom')
    return children
  }
}))

vi.mock('@renderer/components/CodeStyleProvider', () => ({
  CodeStyleProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('@renderer/components/ConversationNotificationRuntime', () => ({
  ConversationNotificationRuntime: () => null
}))
vi.mock('@renderer/components/PopupHost', () => ({ PopupHost: () => null }))
vi.mock('@renderer/components/ToastHost', () => ({ default: () => null }))
vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/hooks/useAutoBackupEvents', () => ({ useAutoBackupEvents: mocks.useAutoBackupEvents }))
vi.mock('@renderer/services/imageExportModeChooser', () => ({ registerImageModeChooser: () => {} }))

describe('SubWindowApp top-level error boundary', () => {
  beforeEach(() => {
    mocks.themeProviderThrows = true
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

describe('SubWindowApp automatic backup wiring', () => {
  beforeEach(() => {
    mocks.themeProviderThrows = false
    mocks.useAutoBackupEvents.mockClear()
  })

  // A detached window renders the same settings panels as main, so it must track
  // automatic backup state — but the toast/notification for one backup belongs to
  // exactly one window, so only main may notify.
  it('tracks automatic backup state without duplicating the main window notifications', () => {
    render(<SubWindowApp />)

    expect(mocks.useAutoBackupEvents).toHaveBeenCalledWith({ notificationsEnabled: false })
  })
})
