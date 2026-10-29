// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({
  useOpenReleaseNotes: () => vi.fn()
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: {
    show: mocks.showUpdatePopup
  }
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: { children: React.ReactNode }) => children,
  CommandShortcut: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'globalSearch.open': 'Open global search',
        'settings.about.updateAvailable': 'Found new version',
        'settings.title': 'Settings',
        'common.settings': 'Settings',
        'sidebar.account_menu': 'Account menu',
        'help.title': 'Help'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => null
}))

import { AppUpdateButton, ShellTabBarActions } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  MockCacheUtils.resetMocks()
  MockUsePreferenceUtils.resetMocks()
  updateState.available = false
  updateState.downloaded = false
  updateState.info = null
})

describe('ShellTabBarActions', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'User')
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
      'Open global search',
      'Account menu'
    ])
  })

  it('keeps theme and settings actions out of the tab bar while the sidebar is visible', () => {
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('opens settings through the tab bar account menu when the sidebar is hidden', async () => {
    const user = userEvent.setup()
    cacheService.setPersist('ui.sidebar.width', 0)

    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Account menu' })).getByRole('button', { name: 'Settings' })
    )

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
    expect(screen.queryByRole('dialog', { name: 'Account menu' })).not.toBeInTheDocument()
  })
  it('opens feedback from the avatar menu and gives the dialog focus', async () => {
    cacheService.setPersist('ui.sidebar.width', 0)
    const user = userEvent.setup()
    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.hover(screen.getByRole('button', { name: 'Help' }))
    await user.click(await screen.findByRole('button', { name: 'help.feedback' }))

    const feedback = await screen.findByRole('dialog', { name: 'settings.about.feedback.dialog.title' })
    expect(screen.queryByRole('dialog', { name: 'Account menu' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(within(feedback).getByRole('button', { name: /settings.about.feedback.diagnostics.title/ })).toHaveFocus()
    )
  })

  it('does not reopen the account menu after changing between hidden and visible sidebar layouts', async () => {
    cacheService.setPersist('ui.sidebar.width', 0)
    const user = userEvent.setup()
    render(<ShellTabBarActions />)
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('dialog', { name: 'Account menu' })).toBeVisible()

    act(() => cacheService.setPersist('ui.sidebar.width', 50))
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Account menu' })).not.toBeInTheDocument()
    act(() => cacheService.setPersist('ui.sidebar.width', 0))
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Account menu' })).not.toBeInTheDocument()
  })
})
