// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    openSettingsWindow: vi.fn(),
    openTab: vi.fn(),
    settingsOpenTarget: 'window'
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.settings.open_target') return [mocks.settingsOpenTarget]
    if (key === 'app.use_system_title_bar') return [false]
    return [undefined]
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: vi.fn() })
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({ openTab: mocks.openTab })
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabel: () => 'Light'
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: mocks.openSettingsWindow
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: () => 'Settings'
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
  mocks.settingsOpenTarget = 'window'
})

describe('ShellTabBarActions', () => {
  it('opens settings in the main tab when app target is selected', async () => {
    const user = userEvent.setup()
    mocks.settingsOpenTarget = 'app'

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'Settings' })
    expect(mocks.openSettingsWindow).not.toHaveBeenCalled()
  })

  it('opens the settings window when window target is selected', async () => {
    const user = userEvent.setup()

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsWindow).toHaveBeenCalledWith('/settings/provider')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
