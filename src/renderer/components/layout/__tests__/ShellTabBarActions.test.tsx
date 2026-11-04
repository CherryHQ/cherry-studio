// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const { mocks, updateState } = vi.hoisted(() => ({
  mocks: {
    ipcRequest: vi.fn(),
    loggerError: vi.fn(),
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
      error: mocks.loggerError
    })
  }
}))

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

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
        'quickAssistant.tooltip.open': 'Open Quick Assistant',
        'settings.about.updateAvailable': 'Found new version',
        'settings.title': 'Settings',
        'sidebar.account_menu': 'Account menu'
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
  updateState.available = false
  updateState.downloaded = false
  updateState.info = null
})

describe('ShellTabBarActions', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.show_in_tab_bar', true)
    mocks.ipcRequest.mockResolvedValue(undefined)
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

  it('shows the Quick Assistant action when the feature and tab bar entry are enabled', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    render(<ShellTabBarActions />)

    expect(screen.getByRole('button', { name: 'Open Quick Assistant' })).toBeInTheDocument()
  })

  it.each([
    [false, true],
    [true, false]
  ])('hides the Quick Assistant action when enabled=%s and tabBarEntry=%s', (enabled, tabBarEntry) => {
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', enabled)
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.show_in_tab_bar', tabBarEntry)
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Open Quick Assistant' })).not.toBeInTheDocument()
  })

  it('opens the Quick Assistant from the action area', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)

    render(<ShellTabBarActions />)
    await user.click(screen.getByRole('button', { name: 'Open Quick Assistant' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('quick_assistant.show')
  })

  it('logs Quick Assistant launcher failures', async () => {
    const user = userEvent.setup()
    const error = new Error('open failed')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    mocks.ipcRequest.mockRejectedValueOnce(error)

    render(<ShellTabBarActions />)
    await user.click(screen.getByRole('button', { name: 'Open Quick Assistant' }))

    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open Quick Assistant', error))
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
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Found new version',
      'Open Quick Assistant',
      'Open global search',
      'Settings'
    ])
  })

  it.each([50, 180])('keeps settings in the sidebar at width %ipx', (width) => {
    cacheService.setPersist('ui.sidebar.width', width)
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('opens settings from the right action area when the sidebar is hidden', async () => {
    cacheService.setPersist('ui.sidebar.width', 0)
    const user = userEvent.setup()
    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })
})
