import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

const ipcRequestMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useApiGateway } from '../useApiGateway'

describe('useApiGateway', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    ipcRequestMock.mockReset()
  })

  it('does not promote `enabled` when the gateway is only running (e.g. under a transient lease)', () => {
    // Main publishes running=true whenever the server is actually listening — including while a
    // transient PDF-translation lease holds it up, with the user never having enabled the gateway.
    // The hook must NOT infer `enabled` from `running`: otherwise the lease would persist an
    // "enabled" the user never chose, and (because the settings page gates on `running`) it would
    // also let the port / API key be edited against a live gateway.
    MockUsePreferenceUtils.setPreferenceValue('feature.api_gateway.enabled', false)
    MockUseCacheUtils.setSharedCacheValue('feature.api_gateway.running', true)

    const { result } = renderHook(() => useApiGateway())

    expect(result.current.apiGatewayRunning).toBe(true)
    expect(result.current.apiGatewayConfig.enabled).toBe(false)
    // No `running → enabled` inference remains: `enabled` stays false after mount + effects.
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.api_gateway.enabled')).toBe(false)
  })

  it('reports that stopping is deferred while a translation lease keeps the gateway running', async () => {
    ipcRequestMock.mockResolvedValue({ success: true, outcome: 'deferred' })
    const { result } = renderHook(() => useApiGateway())

    await act(() => result.current.stopApiGateway())

    expect(toast.info).toHaveBeenCalledWith('apiGateway.messages.stopDeferred')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
