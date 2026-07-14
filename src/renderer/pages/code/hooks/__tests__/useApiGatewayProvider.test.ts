import { preferenceService } from '@data/PreferenceService'
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
  startApiGateway: vi.fn<() => Promise<boolean>>(),
  setApiGatewayEnabled: vi.fn()
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: mocks.apiGatewayConfig,
    apiGatewayRunning: mocks.apiGatewayRunning,
    startApiGateway: mocks.startApiGateway,
    setApiGatewayEnabled: mocks.setApiGatewayEnabled
  })
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: { get: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useApiGatewayProvider.ensureReady', () => {
  beforeEach(() => {
    mocks.apiGatewayConfig = { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-old', enabled: false }
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockReset()
    mocks.setApiGatewayEnabled.mockReset()
    vi.mocked(preferenceService.get).mockReset()
  })

  it('rejects (never returns a stale key) when a non-running gateway fails to start', async () => {
    // The reviewer's failure mode: a persisted key exists (main writes it before binding + it
    // survives a stop), but the server is not listening and the start attempt fails.
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue(false)
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-old')

    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureReady()).rejects.toThrow(/failed to start/)
  })

  it('returns the freshly-read key once the start confirms the gateway is running', async () => {
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockResolvedValue(true)
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-fresh')

    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureReady()).resolves.toBe('cs-sk-fresh')
  })

  it('returns the key without starting when the gateway is already running', async () => {
    mocks.apiGatewayRunning = true
    mocks.apiGatewayConfig = { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-live', enabled: true }
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-live')

    const { result } = renderHook(() => useApiGatewayProvider())

    await expect(result.current!.ensureReady()).resolves.toBe('cs-sk-live')
    expect(mocks.startApiGateway).not.toHaveBeenCalled()
  })
})
