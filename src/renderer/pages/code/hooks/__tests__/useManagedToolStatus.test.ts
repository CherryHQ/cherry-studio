import { cacheService } from '@data/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

const { useManagedToolStatus } = await import('../useManagedToolStatus')

describe('useManagedToolStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheService.deleteShared('feature.deepseek_harness.status')
    cacheService.deleteShared('feature.openclaw.gateway_status')
    request.mockResolvedValue({ status: 'stopped' })
  })

  it('reads and follows the DeepSeek Harness shared snapshot', () => {
    cacheService.setShared('feature.deepseek_harness.status', {
      status: 'running',
      url: 'http://127.0.0.1:45231'
    })
    const { result } = renderHook(() => useManagedToolStatus('deepseek-harness', true))

    expect(result.current).toEqual({ status: 'running', url: 'http://127.0.0.1:45231' })
    act(() => cacheService.setShared('feature.deepseek_harness.status', { status: 'error' }))
    expect(result.current).toEqual({ status: 'error' })
    expect(request).not.toHaveBeenCalled()
  })

  it('uses get_status only to trigger OpenClaw discovery', async () => {
    cacheService.setShared('feature.openclaw.gateway_status', 'stopped')
    request.mockResolvedValue({ status: 'running' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))

    await act(async () => {})
    expect(request).toHaveBeenCalledWith('openclaw.get_status')
    expect(result.current).toEqual({ status: 'stopped' })

    act(() => cacheService.setShared('feature.openclaw.gateway_status', 'running'))
    expect(result.current).toEqual({ status: 'running' })
  })

  it('does not probe while disabled', async () => {
    cacheService.setShared('feature.openclaw.gateway_status', 'running')
    const { result } = renderHook(() => useManagedToolStatus('openclaw', false))

    await act(async () => {})
    expect(result.current).toEqual({ status: 'stopped' })
    expect(request).not.toHaveBeenCalled()
  })

  it('probes when OpenClaw becomes selected', async () => {
    const { rerender } = renderHook(({ enabled }) => useManagedToolStatus('openclaw', enabled), {
      initialProps: { enabled: false }
    })

    rerender({ enabled: true })
    await act(async () => {})
    expect(request).toHaveBeenCalledOnce()
  })
})
