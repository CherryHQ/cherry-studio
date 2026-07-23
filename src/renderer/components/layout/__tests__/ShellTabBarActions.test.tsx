// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, platformState, prefState } = vi.hoisted(() => ({
  mocks: {
    openSettingsTab: vi.fn(),
    showSearchPopup: vi.fn()
  },
  // Mutable so each test can pick a platform / title-bar combination.
  platformState: { isWin: false, isLinux: false },
  prefState: { useSystemTitleBar: false }
}))

vi.mock('@renderer/utils/platform', () => ({
  get isWin() {
    return platformState.isWin
  },
  get isLinux() {
    return platformState.isLinux
  },
  isMac: false,
  platform: undefined,
  isDev: false,
  isProd: false
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
    if (key === 'app.use_system_title_bar') return [prefState.useSystemTitleBar]
    return [undefined]
  }
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
        'settings.title': 'Settings'
      })[key] ?? key
  })
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => null
}))

import { ShellTabBarActions, SidebarShellActions, useShellTabBarLayout } from '../ShellTabBarActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  platformState.isWin = false
  platformState.isLinux = false
  prefState.useSystemTitleBar = false
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
    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
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

describe('useShellTabBarLayout', () => {
  // The right padding reserves space for the absolutely-positioned action cluster AND a small
  // draggable gap between the last tab / "+" button and those buttons (Chrome-style, so the
  // window stays easy to grab-move). Its exact value is a deliberate UX choice — assert it.
  it('reserves the macOS padding when there are no in-app window controls', () => {
    const { result } = renderHook(() => useShellTabBarLayout())

    expect(result.current.hasWindowControls).toBe(false)
    expect(result.current.rightPaddingClass).toBe('pr-[72px]')
  })

  it('reserves the wider padding on Windows (in-app window controls present)', () => {
    platformState.isWin = true

    const { result } = renderHook(() => useShellTabBarLayout())

    expect(result.current.hasWindowControls).toBe(true)
    expect(result.current.rightPaddingClass).toBe('pr-[200px]')
  })

  it('reserves the wider padding on Linux without the system title bar', () => {
    platformState.isLinux = true
    prefState.useSystemTitleBar = false

    const { result } = renderHook(() => useShellTabBarLayout())

    expect(result.current.hasWindowControls).toBe(true)
    expect(result.current.rightPaddingClass).toBe('pr-[200px]')
  })

  it('uses the macOS padding on Linux when the system title bar is enabled', () => {
    platformState.isLinux = true
    prefState.useSystemTitleBar = true

    const { result } = renderHook(() => useShellTabBarLayout())

    expect(result.current.hasWindowControls).toBe(false)
    expect(result.current.rightPaddingClass).toBe('pr-[72px]')
  })
})
