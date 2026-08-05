import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  gatewayPort: undefined as number | undefined,
  requestMock: vi.fn(),
  openSmartMiniApp: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.gatewayPort, vi.fn()]
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.requestMock }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { useOpenClawGatewayController } = await import('../useOpenClawGatewayController')

const enabledProvider = { id: 'anthropic', name: 'Anthropic' } as Provider

describe('useOpenClawGatewayController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_774_560_000_000)
    mocks.gatewayPort = undefined
    mocks.requestMock.mockImplementation((route: string) => {
      if (route === 'openclaw.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'openclaw.sync_config') return Promise.resolve({ success: true })
      if (route === 'openclaw.start_gateway') return Promise.resolve({ success: true })
      if (route === 'openclaw.get_dashboard_url') return Promise.resolve('https://dashboard.local')
      return Promise.resolve({ success: true })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds a fresh navigation revision while preserving the dashboard token fragment', async () => {
    mocks.requestMock.mockImplementation((route: string) => {
      if (route === 'openclaw.get_status') return Promise.resolve({ status: 'running' })
      if (route === 'openclaw.get_dashboard_url')
        return Promise.resolve('https://dashboard.local/?theme=dark#token=secret')
      return Promise.resolve({ success: true })
    })

    const { result } = renderHook(() =>
      useOpenClawGatewayController({
        selectedCliTool: CodeCli.OPENCLAW,
        enabledProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => {
      await result.current.onOpenDashboard()
    })

    const dashboardUrl = new URL(vi.mocked(mocks.openSmartMiniApp).mock.calls[0][0].url)
    expect(dashboardUrl.searchParams.get('cherry_navigation_revision')).toBe('1774560000000')
    expect(dashboardUrl.searchParams.get('theme')).toBe('dark')
    expect(dashboardUrl.hash).toBe('#token=secret')
  })

  // Regression: the standalone OpenClaw page used to read `feature.openclaw.gateway_port`
  // and forward it to `start_gateway`; that wiring was dropped when the controller moved here,
  // silently pinning every launch to the gateway's hardcoded default port.
  it('forwards the configured gateway port to openclaw.start_gateway instead of undefined', async () => {
    mocks.gatewayPort = 18888

    const { result } = renderHook(() =>
      useOpenClawGatewayController({
        selectedCliTool: CodeCli.OPENCLAW,
        enabledProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith('openclaw.start_gateway', { port: 18888 })
  })

  // Regression: sync_config writes openclaw.json's gateway.port from the service's in-memory
  // port, which is still the stale default until start_gateway runs afterwards. The port must
  // be forwarded to sync_config too, otherwise a custom port is written wrong and the gateway
  // binds the default while the app polls/opens the custom port.
  it('forwards the configured gateway port to openclaw.sync_config so the config is written with the right port', async () => {
    mocks.gatewayPort = 18888

    const { result } = renderHook(() =>
      useOpenClawGatewayController({
        selectedCliTool: CodeCli.OPENCLAW,
        enabledProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith('openclaw.sync_config', {
      uniqueModelId: 'anthropic::claude-sonnet-4-5',
      port: 18888
    })
  })

  it('passes undefined when no custom gateway port preference is set', async () => {
    const { result } = renderHook(() =>
      useOpenClawGatewayController({
        selectedCliTool: CodeCli.OPENCLAW,
        enabledProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.requestMock).toHaveBeenCalledWith('openclaw.start_gateway', { port: undefined })
  })

  it('stops launch and shows the original validation message when config sync fails', async () => {
    const validationMessage = 'tools.web.fetch.ssrfPolicy: Unrecognized key'
    mocks.requestMock.mockImplementation((route: string) => {
      if (route === 'openclaw.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'openclaw.sync_config') return Promise.resolve({ success: false, message: validationMessage })
      return Promise.resolve({ success: true })
    })

    const { result } = renderHook(() =>
      useOpenClawGatewayController({
        selectedCliTool: CodeCli.OPENCLAW,
        enabledProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.requestMock).not.toHaveBeenCalledWith('openclaw.start_gateway', expect.anything())
    expect(mocks.toastError).toHaveBeenCalledWith(validationMessage)
  })
})
