import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gatewayPort: undefined as number | undefined,
  requestMock: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.gatewayPort, vi.fn()]
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.requestMock }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { useOpenClawGatewayController } = await import('../useOpenClawGatewayController')

const enabledProvider = { id: 'anthropic', name: 'Anthropic' } as Provider

describe('useOpenClawGatewayController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gatewayPort = undefined
    window.toast = { error: vi.fn() } as any
    mocks.requestMock.mockImplementation((route: string) => {
      if (route === 'openclaw.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'openclaw.sync_config') return Promise.resolve({ success: true })
      if (route === 'openclaw.start_gateway') return Promise.resolve({ success: true })
      if (route === 'openclaw.get_dashboard_url') return Promise.resolve('https://dashboard.local')
      return Promise.resolve({ success: true })
    })
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

    expect(mocks.requestMock).toHaveBeenCalledWith('openclaw.start_gateway', 18888)
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

    expect(mocks.requestMock).toHaveBeenCalledWith('openclaw.start_gateway', undefined)
  })
})
