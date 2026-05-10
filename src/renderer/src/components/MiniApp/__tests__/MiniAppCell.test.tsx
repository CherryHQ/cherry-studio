import { DataApiError, ErrorCode } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="context-menu">{children}</div>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onSelect,
    variant
  }: {
    children: React.ReactNode
    onSelect?: () => void
    variant?: string
  }) => (
    <button data-testid="context-menu-item" data-variant={variant} onClick={onSelect}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr data-testid="context-menu-separator" />,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu-trigger">{children}</div>
  )
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
  default: ({ app, size }: { app: MiniApp; size: number }) => (
    <div data-testid="mini-app-icon" data-size={size}>
      {app.logo}
    </div>
  )
}))

vi.mock('@renderer/components/IndicatorLight', () => ({
  default: ({ color, size, animation }: { color: string; size: number; animation?: boolean }) => (
    <div data-testid="indicator-light" data-color={color} data-size={size} data-animation={animation} />
  )
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span data-testid="marquee-text">{children}</span>
}))

const mocks = vi.hoisted(() => ({
  miniApps: [] as MiniApp[],
  pinned: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  currentMiniAppId: null as string | null,
  miniAppShow: false,
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  setOpenedKeepAliveMiniApps: vi.fn(),
  removeCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  openTab: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    pinned: mocks.pinned,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    currentMiniAppId: mocks.currentMiniAppId,
    miniAppShow: mocks.miniAppShow,
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
    updateAppStatus: mocks.updateAppStatus,
    removeCustomMiniApp: mocks.removeCustomMiniApp
  })
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({
    isTopNavbar: true
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}
Object.assign(window, { toast: mockToast })

import MiniAppCell from '../MiniApp'

const createMockApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp => ({
  appId,
  name: appId,
  nameKey: undefined,
  url: `https://${appId}.example.com`,
  presetMiniAppId: appId,
  status: 'enabled',
  orderKey: 'a0',
  logo: 'default-logo',
  ...overrides
})

describe('MiniAppCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.miniApps = []
    mocks.pinned = []
    mocks.openedKeepAliveMiniApps = []
    mocks.currentMiniAppId = null
    mocks.miniAppShow = false
    mocks.updateAppStatus.mockResolvedValue(undefined)
    mocks.removeCustomMiniApp.mockResolvedValue(undefined)
  })

  it('renders app with correct name and icon', () => {
    const app = createMockApp('test-app', { name: 'Test Application' })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    expect(screen.getByTestId('mini-app-icon')).toHaveTextContent('default-logo')
    expect(screen.getByTestId('marquee-text')).toHaveTextContent('Test Application')
  })

  it('renders with nameKey translation when available', () => {
    const app = createMockApp('test-app', { nameKey: 'custom.name.key' })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    expect(screen.getByTestId('marquee-text')).toHaveTextContent('custom.name.key')
  })

  it('renders isLast with translated title', () => {
    const app = createMockApp('custom-app')
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} isLast />)

    expect(screen.getByTestId('marquee-text')).toHaveTextContent('settings.miniApps.custom.title')
  })

  it('calls onClick and opens tab when clicked', () => {
    const app = createMockApp('test-app', { name: 'Test App' })
    mocks.miniApps = [app]
    const onClick = vi.fn()

    render(<MiniAppCell app={app} onClick={onClick} />)

    fireEvent.click(screen.getByTestId('context-menu-trigger').firstChild!)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/test-app', {
      title: 'Test App',
      icon: 'default-logo'
    })
  })

  it('shows indicator light when app is opened', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.openedKeepAliveMiniApps = [app]

    render(<MiniAppCell app={app} />)

    expect(screen.getByTestId('indicator-light')).toBeInTheDocument()
    expect(screen.getByTestId('indicator-light')).toHaveAttribute('data-color', '#22c55e')
  })

  it('does not show indicator light when app is not opened', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.openedKeepAliveMiniApps = []

    render(<MiniAppCell app={app} />)

    expect(screen.queryByTestId('indicator-light')).not.toBeInTheDocument()
  })

  it('returns null when app should not be shown', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = []
    mocks.pinned = []

    const { container } = render(<MiniAppCell app={app} />)

    expect(container.firstChild).toBeNull()
  })

  it('shows when app is in miniApps list', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('shows when app is pinned even if not in miniApps', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = []
    mocks.pinned = [app]

    render(<MiniAppCell app={app} />)

    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
  })

  it('toggles pin status when pin menu item is clicked', async () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.pinned = []

    render(<MiniAppCell app={app} />)

    const pinButton = screen.getAllByTestId('context-menu-item')[0]
    expect(pinButton).toHaveTextContent('miniApp.add_to_launchpad')

    await userEvent.click(pinButton)

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('test-app', 'pinned')
  })

  it('unpins when app is already pinned', async () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.pinned = [app]

    render(<MiniAppCell app={app} />)

    const unpinButton = screen.getAllByTestId('context-menu-item')[0]
    expect(unpinButton).toHaveTextContent('miniApp.remove_from_launchpad')

    await userEvent.click(unpinButton)

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('test-app', 'enabled')
  })

  it('shows hide option for non-pinned apps', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.pinned = []

    render(<MiniAppCell app={app} />)

    const menuItems = screen.getAllByTestId('context-menu-item')
    expect(menuItems.some((item) => item.textContent === 'miniApp.sidebar.hide.title')).toBe(true)
  })

  it('hides hide option for pinned apps', () => {
    const app = createMockApp('test-app')
    mocks.miniApps = []
    mocks.pinned = [app]

    render(<MiniAppCell app={app} />)

    const menuItems = screen.getAllByTestId('context-menu-item')
    expect(menuItems.some((item) => item.textContent === 'miniApp.sidebar.hide.title')).toBe(false)
  })

  it('hides app when hide is clicked', async () => {
    const app = createMockApp('test-app')
    const otherApp = createMockApp('other-app')
    mocks.miniApps = [app, otherApp]
    mocks.openedKeepAliveMiniApps = [app, otherApp]
    mocks.pinned = []

    render(<MiniAppCell app={app} />)

    const hideButton = screen
      .getAllByTestId('context-menu-item')
      .find((item) => item.textContent === 'miniApp.sidebar.hide.title')
    await userEvent.click(hideButton!)

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('test-app', 'disabled')
    await waitFor(() => {
      expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalled()
    })
  })

  it('shows remove option for custom apps (no presetMiniAppId)', () => {
    const app = createMockApp('custom-app', { presetMiniAppId: undefined })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    const menuItems = screen.getAllByTestId('context-menu-item')
    expect(menuItems.some((item) => item.textContent === 'miniApp.sidebar.remove_custom.title')).toBe(true)
  })

  it('does not show remove option for preset apps', () => {
    const app = createMockApp('preset-app', { presetMiniAppId: 'preset-id' })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    const menuItems = screen.getAllByTestId('context-menu-item')
    expect(menuItems.some((item) => item.textContent === 'miniApp.sidebar.remove_custom.title')).toBe(false)
  })

  it('removes custom app when remove is clicked', async () => {
    const app = createMockApp('custom-app', { presetMiniAppId: undefined })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    const removeButton = screen
      .getAllByTestId('context-menu-item')
      .find((item) => item.textContent === 'miniApp.sidebar.remove_custom.title')
    await userEvent.click(removeButton!)

    expect(mocks.removeCustomMiniApp).toHaveBeenCalledWith('custom-app')
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('settings.miniApps.custom.remove_success')
    })
  })

  it('handles updateAppStatus error', async () => {
    mocks.updateAppStatus.mockRejectedValueOnce(new Error('Update failed'))

    const app = createMockApp('test-app')
    mocks.miniApps = [app]
    mocks.pinned = []

    render(<MiniAppCell app={app} />)

    const pinButton = screen.getAllByTestId('context-menu-item')[0]
    await userEvent.click(pinButton)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  it('handles removeCustomMiniApp NOT_FOUND error', async () => {
    const mockError = new DataApiError(ErrorCode.NOT_FOUND, 'Not found', 404)
    mocks.removeCustomMiniApp.mockRejectedValueOnce(mockError)

    const app = createMockApp('custom-app', { presetMiniAppId: undefined })
    mocks.miniApps = [app]

    render(<MiniAppCell app={app} />)

    const removeButton = screen
      .getAllByTestId('context-menu-item')
      .find((item) => item.textContent === 'miniApp.sidebar.remove_custom.title')
    await userEvent.click(removeButton!)

    await waitFor(() => {
      expect(mockToast.warning).toHaveBeenCalledWith('miniApp.error.not_found')
    })
  })
})
