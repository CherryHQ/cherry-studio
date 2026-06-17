// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    openSettingsTab: vi.fn(),
    showSearchPopup: vi.fn(),
    toggleTheme: vi.fn()
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
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Kbd: ({ children }: { children?: React.ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.use_system_title_bar') return [false]
    return [undefined]
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: mocks.toggleTheme })
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@renderer/features/command', () => ({
  CommandTooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabelKey: () => 'Light'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'globalSearch.open': 'Open global search',
        'settings.title': 'Settings'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  default: () => null
}))

import { ShellTabBarActions, SidebarShellActions } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ShellTabBarActions', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: vi.fn() }
    })
  })

  it('opens global search from the action area', async () => {
    const user = userEvent.setup()

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: 'Open global search' }))

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('keeps theme and settings actions out of the tab bar', () => {
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
  })

  it('toggles theme from the sidebar icon footer action', async () => {
    const user = userEvent.setup()

    render(<SidebarShellActions layout="icon" onSettingsClick={mocks.openSettingsTab} />)

    await user.click(screen.getByRole('button', { name: 'Light' }))

    expect(mocks.toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('opens the settings tab from the sidebar footer action', async () => {
    const user = userEvent.setup()

    render(<SidebarShellActions layout="icon" onSettingsClick={mocks.openSettingsTab} />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsTab).toHaveBeenCalledTimes(1)
  })

  it('renders sidebar full footer actions with visible labels', () => {
    render(<SidebarShellActions layout="full" onSettingsClick={mocks.openSettingsTab} />)

    expect(screen.getByRole('button', { name: 'Light' })).toHaveTextContent('Light')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveTextContent('Settings')
  })
})
