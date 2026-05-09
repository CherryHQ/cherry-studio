// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    openSettingsWindow: vi.fn(),
    toastError: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.use_system_title_bar') return [false]
    return [undefined]
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: vi.fn() })
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabel: () => 'Light'
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: mocks.openSettingsWindow
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'settings.title' ? 'Settings' : key) })
}))

vi.mock('../../WindowControls', () => ({
  default: () => null
}))

import { ShellTabBarActions } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ShellTabBarActions', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
    })
  })

  it('opens the standalone settings window', async () => {
    const user = userEvent.setup()

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsWindow).toHaveBeenCalledWith('/settings/provider')
  })

  it('shows a toast when opening the settings window fails', async () => {
    const user = userEvent.setup()
    mocks.openSettingsWindow.mockRejectedValueOnce(new Error('IPC failed'))

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith({ title: 'common.error', description: 'IPC failed' })
    })
  })
})
