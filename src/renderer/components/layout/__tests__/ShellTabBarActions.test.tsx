// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheState, mocks, updateState } = vi.hoisted(() => ({
  cacheState: { sidebarWidth: 50 },
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

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => {
    const { variant, size, ...buttonProps } = props
    void variant
    void size

    return (
      <button data-slot="button" type={type} {...buttonProps}>
        {children}
      </button>
    )
  },
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Kbd: ({ children }: { children?: React.ReactNode }) => children
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [cacheState.sidebarWidth, vi.fn()]
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
        'settings.about.updateAvailable': 'Found new version',
        'settings.title': 'Settings'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => null
}))

vi.mock('../HelpMenu', () => ({
  HelpMenu: ({
    layout,
    onFeedbackClick,
    onOverlayOpenChange
  }: {
    layout: string
    onFeedbackClick: () => void
    onOverlayOpenChange?: (open: boolean) => void
  }) => (
    <>
      <button aria-label="Help & Feedback" type="button" onClick={() => onOverlayOpenChange?.(true)}>
        help-{layout}
      </button>
      <button aria-label="Open feedback" type="button" onClick={onFeedbackClick} />
    </>
  )
}))

import { ShellTabBarActions, SidebarShellActions } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  cacheState.sidebarWidth = 50
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

    expect(screen.getByRole('button', { name: 'Open global search' })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: 'Open global search' })).toHaveClass(
      'text-muted-foreground',
      'dark:text-muted-foreground'
    )
    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('shows a ready update and opens its dialog directly', async () => {
    const user = userEvent.setup()
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    const updateButton = screen.getByRole('button', { name: 'Found new version' })
    expect(updateButton.querySelector('svg')).toHaveClass('text-success')

    await user.click(updateButton)

    await waitFor(() => {
      expect(mocks.showUpdatePopup).toHaveBeenCalledWith({ releaseInfo: updateState.info })
    })
  })

  it('keeps the update action hidden until the update is ready to install', () => {
    updateState.available = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Found new version' })).not.toBeInTheDocument()
  })

  it('keeps the update action at the left of the action group', () => {
    cacheState.sidebarWidth = 0
    updateState.available = true
    updateState.downloaded = true
    updateState.info = { version: '2.0.0' }

    render(<ShellTabBarActions />)

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Found new version',
      'Settings',
      'Open global search'
    ])
  })

  it('uses its natural width in the header flex layout with one right padding', () => {
    const { container } = render(<ShellTabBarActions />)
    const actionArea = container.firstElementChild

    expect(actionArea).toHaveClass('shrink-0')
    expect(actionArea).not.toHaveClass('absolute')
    expect(actionArea?.firstElementChild).toHaveClass('pr-2')
  })

  it('keeps theme and settings actions out of the tab bar while the sidebar is visible', () => {
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
  })

  it('opens settings from the tab bar when the sidebar is hidden', async () => {
    const user = userEvent.setup()
    cacheState.sidebarWidth = 0

    render(<ShellTabBarActions />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
  })

  it('does not render the theme toggle in the sidebar footer action', () => {
    render(<SidebarShellActions layout="icon" onFeedbackClick={vi.fn()} onSettingsClick={mocks.openSettingsTab} />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass(
      'text-muted-foreground',
      'dark:text-muted-foreground'
    )
    expect(screen.getByRole('button', { name: 'Help & Feedback' })).toHaveTextContent('help-icon')
  })

  it('opens the settings tab from the sidebar footer action', async () => {
    const user = userEvent.setup()

    render(<SidebarShellActions layout="icon" onFeedbackClick={vi.fn()} onSettingsClick={mocks.openSettingsTab} />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsTab).toHaveBeenCalledTimes(1)
  })

  it('forwards help overlay state from the sidebar footer', async () => {
    const user = userEvent.setup()
    const onOverlayOpenChange = vi.fn()

    render(
      <SidebarShellActions
        layout="icon"
        onFeedbackClick={vi.fn()}
        onSettingsClick={mocks.openSettingsTab}
        onOverlayOpenChange={onOverlayOpenChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Help & Feedback' }))

    expect(onOverlayOpenChange).toHaveBeenCalledWith(true)
  })

  it('forwards feedback requests from the sidebar footer', async () => {
    const user = userEvent.setup()
    const onFeedbackClick = vi.fn()

    render(
      <SidebarShellActions layout="icon" onFeedbackClick={onFeedbackClick} onSettingsClick={mocks.openSettingsTab} />
    )

    await user.click(screen.getByRole('button', { name: 'Open feedback' }))

    expect(onFeedbackClick).toHaveBeenCalledOnce()
  })

  it('renders sidebar full footer actions with visible labels', () => {
    render(<SidebarShellActions layout="full" onFeedbackClick={vi.fn()} onSettingsClick={mocks.openSettingsTab} />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass('justify-start', 'text-foreground')
    expect(screen.getByRole('button', { name: /settings/i })).not.toHaveClass('text-muted-foreground')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveTextContent('Settings')
    expect(screen.getByRole('button', { name: 'Help & Feedback' })).toHaveTextContent('help-full')
  })
})
