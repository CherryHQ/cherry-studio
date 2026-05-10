import type { MiniApp } from '@shared/data/types/miniApp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: vi.fn(() => false),
  setWebviewLoaded: vi.fn(),
  onWebviewStateChange: vi.fn(() => vi.fn())
}))

vi.mock('../components/MinimalToolbar', () => ({
  default: ({ app }: { app: MiniApp }) => <div data-testid="minimal-toolbar">{app.name}</div>
}))

vi.mock('../components/WebviewSearch', () => ({
  default: () => <div data-testid="webview-search">Search</div>
}))

const mockOpenMiniAppKeepAlive = vi.fn()
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({
    openMiniAppKeepAlive: mockOpenMiniAppKeepAlive
  })
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => mockUseMiniAppsReturn
}))

const mockUseParams = vi.fn(() => ({ appId: 'test-app' as string | undefined }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => mockUseParams()
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: ({ logo }: { logo: string }) => <div data-testid="logo-avatar">{logo}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('react-spinners', () => ({
  BeatLoader: (props: { style?: React.CSSProperties }) => (
    <span data-testid="beat-loader" style={props.style}>
      Loading...
    </span>
  )
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

import { getWebviewLoaded } from '@renderer/utils/webviewStateManager'

const mockGetWebviewLoaded = vi.mocked(getWebviewLoaded)

import MiniAppPage from '../MiniAppPage'

const mockUseMiniAppsReturn = {
  allApps: [] as MiniApp[],
  miniApps: [] as MiniApp[],
  disabled: [] as MiniApp[],
  pinned: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  isLoading: false,
  error: null as Error | null,
  currentMiniAppId: null as string | null,
  miniAppShow: false,
  refetch: vi.fn()
}

const createMockApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp => ({
  appId,
  name: appId,
  url: `https://${appId}.example.com`,
  presetMiniAppId: appId,
  status: 'enabled',
  orderKey: 'a0',
  ...overrides
})

describe('MiniAppPage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
    mockUseParams.mockReturnValue({ appId: 'test-app' })
    mockGetWebviewLoaded.mockReturnValue(false)
    Object.assign(window, {
      toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
    })
  })

  it('renders loading state when isLoading is true', () => {
    mockUseMiniAppsReturn.isLoading = true
    mockUseMiniAppsReturn.allApps = []

    render(<MiniAppPage />)
    expect(
      document.querySelector('[style*="react-spinners"], [class*="beat"], span[style*="inline-block"]')
    ).toBeInTheDocument()
  })

  it('renders error state when there is an error', () => {
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = new Error('Failed to load')
    mockUseMiniAppsReturn.allApps = []

    render(<MiniAppPage />)

    expect(screen.getByText('miniApp.error.load_failed')).toBeInTheDocument()
  })

  it('renders not found state when app is not found', () => {
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = []
    mockUseMiniAppsReturn.openedKeepAliveMiniApps = []

    render(<MiniAppPage />)

    expect(screen.getByText('miniApp.error.not_found')).toBeInTheDocument()
  })

  it('renders app page when app is found', async () => {
    const mockApp = createMockApp('test-app', { name: 'Test App', logo: 'test-logo' })
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = [mockApp]
    mockUseMiniAppsReturn.openedKeepAliveMiniApps = []

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(screen.getByTestId('minimal-toolbar')).toHaveTextContent('Test App')
    })
    expect(screen.getByTestId('webview-search')).toBeInTheDocument()
  })

  it('calls openMiniAppKeepAlive when app is found and not loading', async () => {
    const mockApp = createMockApp('test-app')
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = [mockApp]
    mockUseMiniAppsReturn.openedKeepAliveMiniApps = []
    mockOpenMiniAppKeepAlive.mockClear()

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(mockOpenMiniAppKeepAlive).toHaveBeenCalledWith(mockApp)
    })
  })

  it('finds app from openedKeepAliveMiniApps when not in allApps', async () => {
    const keepAliveApp = createMockApp('keep-alive-app', { name: 'Keep Alive App' })
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = []
    mockUseMiniAppsReturn.openedKeepAliveMiniApps = [keepAliveApp]
    mockUseParams.mockReturnValue({ appId: 'keep-alive-app' })

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(screen.getByTestId('minimal-toolbar')).toHaveTextContent('Keep Alive App')
    })
  })

  it('shows loading mask when webview is not ready', async () => {
    const mockApp = createMockApp('test-app', { logo: 'test-logo' })
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = [mockApp]
    mockGetWebviewLoaded.mockReturnValue(false)

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(screen.getByTestId('logo-avatar')).toBeInTheDocument()
    })

    expect(document.querySelector('[style*="react-spinners"]')).toBeInTheDocument()
  })

  it('does not show loading mask when webview is already loaded', async () => {
    const mockApp = createMockApp('test-app', { logo: 'test-logo' })
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = [mockApp]
    mockGetWebviewLoaded.mockReturnValue(true)

    render(<MiniAppPage />)

    await waitFor(() => {
      expect(screen.getByTestId('minimal-toolbar')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('logo-avatar')).not.toBeInTheDocument()
  })

  it('handles missing appId in URL params', () => {
    mockUseParams.mockReturnValue({ appId: undefined })
    mockUseMiniAppsReturn.isLoading = false
    mockUseMiniAppsReturn.error = null
    mockUseMiniAppsReturn.allApps = []
    mockUseMiniAppsReturn.openedKeepAliveMiniApps = []

    render(<MiniAppPage />)

    expect(screen.getByText('miniApp.error.not_found')).toBeInTheDocument()
  })
})
