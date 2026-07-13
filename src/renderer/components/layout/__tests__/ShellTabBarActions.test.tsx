// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    openSettingsTab: vi.fn(),
    showSearchPopup: vi.fn(),
    ipcRequest: vi.fn(),
    quickAssistantEnabled: true,
    showQuickAssistantInTabBar: true
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

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.quick_assistant.enabled') return [mocks.quickAssistantEnabled]
    if (key === 'feature.quick_assistant.show_in_tab_bar') return [mocks.showQuickAssistantInTabBar]
    return [undefined]
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
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
        'settings.title': 'Settings'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  useHasWindowControls: () => false,
  WindowControls: () => null
}))

import { ShellTabBarActions, SidebarShellActions } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ShellTabBarActions', () => {
  beforeEach(() => {
    mocks.quickAssistantEnabled = true
    mocks.showQuickAssistantInTabBar = true
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
    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('shows the Quick Assistant action only when the feature and tab bar entry are enabled', () => {
    const { rerender } = render(<ShellTabBarActions />)

    expect(screen.getByRole('button', { name: 'Open Quick Assistant' })).toBeInTheDocument()

    mocks.quickAssistantEnabled = false
    rerender(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Open Quick Assistant' })).not.toBeInTheDocument()

    mocks.quickAssistantEnabled = true
    mocks.showQuickAssistantInTabBar = false
    rerender(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Open Quick Assistant' })).not.toBeInTheDocument()
  })

  it('participates in the tab bar flex layout and reserves a draggable gap', () => {
    render(<ShellTabBarActions />)

    expect(screen.getByTestId('shell-tab-bar-actions')).toHaveClass('shrink-0')
    expect(screen.getByTestId('shell-tab-bar-actions')).not.toHaveClass('absolute')
    expect(screen.getByTestId('shell-tab-bar-drag-gap')).toHaveClass('w-4', 'shrink-0', '[-webkit-app-region:drag]')
  })

  it('shows the Quick Assistant without toggling it', async () => {
    const user = userEvent.setup()

    render(<ShellTabBarActions />)
    await user.click(screen.getByRole('button', { name: 'Open Quick Assistant' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('quick_assistant.show')
  })

  it('keeps theme and settings actions out of the tab bar', () => {
    render(<ShellTabBarActions />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
  })

  it('does not render the theme toggle in the sidebar footer action', () => {
    render(<SidebarShellActions layout="icon" onSettingsClick={mocks.openSettingsTab} />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass(
      'text-muted-foreground',
      'dark:text-muted-foreground'
    )
  })

  it('opens the settings tab from the sidebar footer action', async () => {
    const user = userEvent.setup()

    render(<SidebarShellActions layout="icon" onSettingsClick={mocks.openSettingsTab} />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(mocks.openSettingsTab).toHaveBeenCalledTimes(1)
  })

  it('renders sidebar full footer actions with visible labels', () => {
    render(<SidebarShellActions layout="full" onSettingsClick={mocks.openSettingsTab} />)

    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute('data-slot', 'button')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass(
      'justify-start',
      'text-foreground',
      'dark:text-foreground'
    )
    expect(screen.getByRole('button', { name: /settings/i })).not.toHaveClass('text-muted-foreground')
    expect(screen.getByRole('button', { name: /settings/i })).toHaveTextContent('Settings')
  })
})
