import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'

import { useApiGatewayProvider } from '../useApiGatewayProvider'

const mocks = vi.hoisted(() => ({
  apiGatewayRunning: false,
  startApiGateway: vi.fn<() => Promise<boolean>>()
}))

vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: 'cs-sk-old', enabled: false },
    apiGatewayRunning: mocks.apiGatewayRunning,
    startApiGateway: mocks.startApiGateway
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useApiGatewayProvider gateway lifecycle', () => {
  beforeEach(() => {
    mocks.apiGatewayRunning = false
    mocks.startApiGateway.mockReset()
    vi.mocked(preferenceService.get).mockReset()
    vi.stubGlobal('api', { preference: { get: vi.fn() } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects when a non-running gateway fails to start', async () => {
    mocks.startApiGateway.mockResolvedValue(false)
    const { result } = renderHook(() => useApiGatewayProvider())
    await expect(result.current!.ensureRunning()).rejects.toThrow('API gateway failed to start')
  })

  it('does not restart a running gateway', async () => {
    mocks.apiGatewayRunning = true
    mocks.startApiGateway.mockRejectedValue(new Error('Unexpected restart'))
    const { result } = renderHook(() => useApiGatewayProvider())
    await expect(result.current!.ensureRunning()).resolves.toBeUndefined()
  })

  it.each([null, 'cs-sk-old'])(
    'reads the persisted key even when the renderer cache contains %s',
    async (cachedKey) => {
      vi.mocked(preferenceService.get).mockResolvedValue(cachedKey)
      vi.mocked(window.api.preference.get)
        .mockResolvedValueOnce('cs-sk-generated')
        .mockResolvedValueOnce('cs-sk-rotated')
      const { result } = renderHook(() => useApiGatewayProvider())

      await expect(result.current!.getApiKey()).resolves.toBe('cs-sk-generated')
      await expect(result.current!.getApiKey()).resolves.toBe('cs-sk-rotated')
    }
  )

  it('rejects a missing persisted key rather than using the old displayed key', async () => {
    vi.mocked(window.api.preference.get).mockResolvedValue(null)
    const { result } = renderHook(() => useApiGatewayProvider())
    await expect(result.current!.getApiKey()).rejects.toThrow('API gateway did not provide a key')
  })

  it('propagates a failed persisted read rather than falling back to the renderer cache', async () => {
    vi.mocked(preferenceService.get).mockResolvedValue('cs-sk-old')
    vi.mocked(window.api.preference.get).mockRejectedValue(new Error('IPC unavailable'))
    const { result } = renderHook(() => useApiGatewayProvider())
    await expect(result.current!.getApiKey()).rejects.toThrow('IPC unavailable')
  })
})
