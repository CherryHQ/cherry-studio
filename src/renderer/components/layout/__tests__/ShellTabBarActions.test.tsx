// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const { mocks, updateState } = vi.hoisted(() => ({
  mocks: {
    openSettingsTab: vi.fn(),
    showSearchPopup: vi.fn(),
    showUpdatePopup: vi.fn()
  },
  updateState: {
    available: false,
    downloaded: false,
    info: null as { version: string } | null
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({ appUpdateState: updateState, updateAppUpdateState: vi.fn() })
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('../HelpMenu', () => ({
  HelpMenu: () => <button aria-label="Help" type="button" />
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: {
    show: mocks.showUpdatePopup
  }
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'globalSearch.open': 'Open global search',
        'settings.about.updateAvailable': 'Found new version',
        'settings.title': 'Settings'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => null
}))

import { AppUpdateButton, ShellTabBarActions, SidebarSettingsButton } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  MockCacheUtils.resetMocks()
  updateState.available = false
  updateState.downloaded = false
  updateState.info = null
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

  it('shows a ready update and opens its dialog directly', async () => {
    const user = userEvent.setup()
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<AppUpdateButton />)

    const updateButton = screen.getByRole('button', { name: 'Found new version' })

    await user.click(updateButton)

    await waitFor(() => {
      expect(mocks.showUpdatePopup).toHaveBeenCalledWith({ releaseInfo: updateState.info })
    })
  })

  it('keeps the update action hidden until the update is ready to install', () => {
    updateState.available = true
    updateState.info = { version: '2.0.0' }

    render(<AppUpdateButton />)

    expect(screen.queryByRole('button', { name: 'Found new version' })).not.toBeInTheDocument()
  })

  it('keeps the ready update out of the tab bar when the full sidebar owns it', () => {
    cacheService.setPersist('ui.sidebar.width', 180)
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Found new version' })).not.toBeInTheDocument()
  })

  it('keeps the update action at the left of the hidden-sidebar action group', () => {
    cacheService.setPersist('ui.sidebar.width', 0)
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Found new version',
      'Help',
      'Settings',
      'Open global search'
    ])
  })

  it('keeps theme and settings actions out of the tab bar while the sidebar is visible', () => {
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('opens settings from the tab bar when the sidebar is hidden', async () => {
    const user = userEvent.setup()
    cacheService.setPersist('ui.sidebar.width', 0)

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
  })
})

describe('SidebarSettingsButton', () => {
  it('opens settings from the icon action', async () => {
    const user = userEvent.setup()
    render(<SidebarSettingsButton layout="icon" />)

    const button = screen.getByRole('button', { name: 'Settings' })
    await user.click(button)
    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
  })

  it('renders a labeled full-width action in the full sidebar layout', () => {
    render(<SidebarSettingsButton layout="full" />)

    const button = screen.getByRole('button', { name: 'Settings' })
    expect(button).toHaveTextContent('Settings')
  })
})
