import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'

import { useApiGatewayProvider } from '../useApiGatewayProvider'

const mocks = vi.hoisted(() => ({
  apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-old', enabled: false } as {
    host: string
    port: number
    apiKey: string | null
    enabled: boolean
  },
  apiGatewayRunning: false,
  startApiGateway: vi.fn<() => Promise<boolean>>()
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: mocks.apiGatewayConfig,
    apiGatewayRunning: mocks.apiGatewayRunning,
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
    mocks.startApiGateway.mockReset()
    vi.mocked(preferenceService.get).mockReset()
  })

  it('rejects when a non-running gateway fails to start', async () => {
    // The reviewer's failure mode: a persisted key exists (main writes it before binding + it
    // survives a stop), but the server is not listening and the start attempt fails.
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue(false)
    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureRunning()).rejects.toThrow(/failed to start/)
    expect(preferenceService.get).not.toHaveBeenCalled()
  })

  it('starts the gateway without reading its key', async () => {
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue(true)

    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureRunning()).resolves.toBeUndefined()
    expect(preferenceService.get).not.toHaveBeenCalled()
  })

  it('does not restart a running gateway', async () => {
    mocks.apiGatewayRunning = true
    mocks.apiGatewayConfig = { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-live', enabled: true }

    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureRunning()).resolves.toBeUndefined()
    expect(mocks.startApiGateway).not.toHaveBeenCalled()
  })

  it('reads the key independently of gateway startup', async () => {
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-current')
    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.getApiKey()).resolves.toBe('cs-sk-current')
    expect(mocks.startApiGateway).not.toHaveBeenCalled()
  })
})
