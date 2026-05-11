import type { MiniApp } from '@shared/data/types/miniApp'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    className
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    'aria-label'?: string
    'aria-pressed'?: boolean
    className?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={className}
      data-testid={`btn-${ariaLabel?.replace(/\s+/g, '-').toLowerCase() || 'button'}`}>
      {children}
    </button>
  ),
  Tooltip: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <div data-testid="tooltip" data-content={content}>
      {children}
    </div>
  )
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(' ')
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/constant', () => ({
  isDev: true
}))

const mocks = vi.hoisted(() => ({
  allApps: [] as MiniApp[],
  pinned: [] as MiniApp[],
  openLinkExternal: false,
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  setOpenLinkExternal: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: mocks.allApps,
    pinned: mocks.pinned,
    updateAppStatus: mocks.updateAppStatus
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.openLinkExternal, mocks.setOpenLinkExternal]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockOpenWebsite = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    openWebsite: mockOpenWebsite
  }
})

const mockToast = {
  error: vi.fn()
}
Object.defineProperty(window, 'toast', {
  configurable: true,
  value: mockToast
})

import MinimalToolbar from '../MinimalToolbar'

const createMockApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp => ({
  appId,
  name: appId,
  url: `https://${appId}.example.com`,
  presetMiniAppId: appId,
  status: 'enabled',
  orderKey: 'a0',
  ...overrides
})

const createMockWebview = (overrides?: Partial<WebviewTag>): WebviewTag => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  const webview = {
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => true),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    openDevTools: vi.fn(),
    src: 'https://test.example.com',
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener)
    }),
    emit: (type: string) => {
      listeners.get(type)?.forEach((listener) => {
        if (typeof listener === 'function') {
          listener(new Event(type))
        } else {
          listener.handleEvent(new Event(type))
        }
      })
    }
  } as unknown as WebviewTag & { emit: (type: string) => void }

  return Object.assign(webview, overrides || {})
}

describe('MinimalToolbar', () => {
  const mockOnReload = vi.fn()
  const mockOnOpenDevTools = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.allApps = []
    mocks.pinned = []
    mocks.openLinkExternal = false
    mocks.updateAppStatus.mockResolvedValue(undefined)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders all toolbar buttons', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    expect(screen.getByLabelText('miniApp.popup.goBack')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.popup.goForward')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.popup.refresh')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.popup.openExternal')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.add_to_launchpad')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.popup.open_link_external_off')).toBeInTheDocument()
    expect(screen.getByLabelText('miniApp.popup.devtools')).toBeInTheDocument()
  })

  it('calls goBack when back button is clicked', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    vi.advanceTimersByTime(200)

    const backButton = screen.getByLabelText('miniApp.popup.goBack')
    fireEvent.click(backButton)

    expect(webview.goBack).toHaveBeenCalledTimes(1)
  })

  it('calls goForward when forward button is clicked', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    vi.advanceTimersByTime(200)

    const forwardButton = screen.getByLabelText('miniApp.popup.goForward')
    fireEvent.click(forwardButton)

    expect(webview.goForward).toHaveBeenCalledTimes(1)
  })

  it('calls onReload when refresh button is clicked', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const refreshButton = screen.getByLabelText('miniApp.popup.refresh')
    fireEvent.click(refreshButton)

    expect(mockOnReload).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenDevTools when devtools button is clicked', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const devtoolsButton = screen.getByLabelText('miniApp.popup.devtools')
    fireEvent.click(devtoolsButton)

    expect(mockOnOpenDevTools).toHaveBeenCalledTimes(1)
  })

  it('opens external link when openExternal button is clicked', () => {
    const app = createMockApp('test-app', { url: 'https://example.com' })
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl="https://current.example.com"
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const openExternalButton = screen.getByLabelText('miniApp.popup.openExternal')
    fireEvent.click(openExternalButton)

    expect(mockOpenWebsite).toHaveBeenCalledWith('https://current.example.com')
  })

  it('falls back to app.url when currentUrl is null', () => {
    const app = createMockApp('test-app', { url: 'https://fallback.example.com' })
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={null}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const openExternalButton = screen.getByLabelText('miniApp.popup.openExternal')
    fireEvent.click(openExternalButton)

    expect(mockOpenWebsite).toHaveBeenCalledWith('https://fallback.example.com')
  })

  it('does not show openExternal button for non-HTTP URLs', () => {
    const app = createMockApp('test-app', { url: 'file:///local/path' })
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    expect(screen.queryByLabelText('miniApp.popup.openExternal')).not.toBeInTheDocument()
  })

  it('toggles pin status when pin button is clicked', async () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.pinned = []

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const pinButton = screen.getByLabelText('miniApp.add_to_launchpad')
    expect(pinButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pinButton)

    await waitFor(() => {
      expect(mocks.updateAppStatus).toHaveBeenCalledWith('test-app', 'pinned')
    })
  })

  it('shows unpinned state when app is already pinned', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.pinned = [app]

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const pinButton = screen.getByLabelText('miniApp.remove_from_launchpad')
    expect(pinButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('unpins when pin button is clicked on pinned app', async () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.pinned = [app]

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const pinButton = screen.getByLabelText('miniApp.remove_from_launchpad')
    fireEvent.click(pinButton)

    await waitFor(() => {
      expect(mocks.updateAppStatus).toHaveBeenCalledWith('test-app', 'enabled')
    })
  })

  it('does not show pin button when app is not in allApps', () => {
    const app = createMockApp('test-app')
    mocks.allApps = []
    mocks.pinned = []

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    expect(screen.queryByLabelText('miniApp.add_to_launchpad')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('miniApp.remove_from_launchpad')).not.toBeInTheDocument()
  })

  it('toggles openLinkExternal preference', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.openLinkExternal = false

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const linkButton = screen.getByLabelText('miniApp.popup.open_link_external_off')
    expect(linkButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(linkButton)

    expect(mocks.setOpenLinkExternal).toHaveBeenCalledWith(true)
  })

  it('shows open_link_external_on when preference is true', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.openLinkExternal = true

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const linkButton = screen.getByLabelText('miniApp.popup.open_link_external_on')
    expect(linkButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables back/forward buttons when navigation is not possible', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview({
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false)
    })
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    vi.advanceTimersByTime(200)

    const backButton = screen.getByLabelText('miniApp.popup.goBack')
    const forwardButton = screen.getByLabelText('miniApp.popup.goForward')

    expect(backButton).toBeDisabled()
    expect(forwardButton).toBeDisabled()
  })

  it('handles webview navigation errors gracefully', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview({
      canGoBack: vi.fn(() => {
        throw new Error('WebView not ready')
      }),
      canGoForward: vi.fn(() => false)
    })
    const webviewRef = { current: webview }

    expect(() => {
      render(
        <MinimalToolbar
          app={app}
          webviewRef={webviewRef}
          currentUrl={app.url}
          onReload={mockOnReload}
          onOpenDevTools={mockOnOpenDevTools}
        />
      )
    }).not.toThrow()
  })

  it('updates navigation state on webview navigation events', () => {
    const app = createMockApp('test-app')
    mocks.allApps = [app]
    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )
    vi.advanceTimersByTime(200)

    const backButton = screen.getByLabelText('miniApp.popup.goBack')
    expect(backButton).not.toBeDisabled()
  })

  it('handles pin toggle errors', async () => {
    mocks.updateAppStatus.mockRejectedValueOnce(new Error('Pin failed'))

    const app = createMockApp('test-app')
    mocks.allApps = [app]
    mocks.pinned = []

    const webview = createMockWebview()
    const webviewRef = { current: webview }

    render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={app.url}
        onReload={mockOnReload}
        onOpenDevTools={mockOnOpenDevTools}
      />
    )

    const pinButton = screen.getByLabelText('miniApp.add_to_launchpad')
    fireEvent.click(pinButton)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })
})
