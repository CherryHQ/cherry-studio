import { preferenceService } from '@data/PreferenceService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useApiGatewayProvider } from '../useApiGatewayProvider'

const mocks = vi.hoisted(() => ({
  apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-old', enabled: false } as {
    host: string
    port: number
    apiKey: string | null
    enabled: boolean
  },
  apiGatewayRunning: false,
  getApiGatewayRuntimeAddress: vi.fn<() => Promise<null | { host: string; port: number }>>(),
  startApiGateway: vi.fn<() => Promise<null | { host: string; port: number }>>()
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: mocks.apiGatewayConfig,
    apiGatewayRunning: mocks.apiGatewayRunning,
    getApiGatewayRuntimeAddress: mocks.getApiGatewayRuntimeAddress,
    startApiGateway: mocks.startApiGateway
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useApiGatewayProvider gateway lifecycle', () => {
  beforeEach(() => {
    mocks.apiGatewayConfig = { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-old', enabled: false }
    mocks.apiGatewayRunning = false
    mocks.getApiGatewayRuntimeAddress.mockReset()
    mocks.startApiGateway.mockReset()
    vi.mocked(preferenceService.get).mockReset()
  })

  it('rejects when a non-running gateway fails to start', async () => {
    // The reviewer's failure mode: a persisted key exists (main writes it before binding + it
    // survives a stop), but the server is not listening and the start attempt fails.
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue(null)
    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureRunning()).rejects.toThrow(/failed to start/)
    expect(preferenceService.get).not.toHaveBeenCalled()
  })

  it('uses the bound runtime address instead of a stale cached preference after startup', async () => {
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue({ host: '127.0.0.1', port: 24444 })
    vi.mocked(preferenceService.get).mockResolvedValueOnce('127.0.0.1').mockResolvedValueOnce(23333)

    const { result } = renderHook(() => useApiGatewayProvider())

    const provider = await result.current!.ensureRunning()
    expect(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl).toBe('http://127.0.0.1:24444')
    expect(preferenceService.get).not.toHaveBeenCalled()
  })

  it('queries the bound address without restarting a running gateway', async () => {
    mocks.apiGatewayRunning = true
    mocks.apiGatewayConfig = { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-live', enabled: true }
    mocks.getApiGatewayRuntimeAddress.mockResolvedValue({ host: '127.0.0.1', port: 24444 })

    const { result } = renderHook(() => useApiGatewayProvider())

    const provider = await result.current!.ensureRunning()
    expect(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl).toBe('http://127.0.0.1:24444')
    expect(mocks.getApiGatewayRuntimeAddress).toHaveBeenCalledOnce()
    expect(mocks.startApiGateway).not.toHaveBeenCalled()
    expect(preferenceService.get).not.toHaveBeenCalled()
  })

  it('reads the key independently of gateway startup', async () => {
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-current')
    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.getApiKey()).resolves.toBe('cs-sk-current')
    expect(mocks.startApiGateway).not.toHaveBeenCalled()
  })
})
