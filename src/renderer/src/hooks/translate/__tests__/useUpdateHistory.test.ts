import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useUpdateHistory } from '../useUpdateHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useUpdateHistory', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against PATCH /translate/histories/:id with the correct refresh key', () => {
    renderHook(() => useUpdateHistory('hist-123'))

    expect(mockUseMutation).toHaveBeenCalledWith(
      'PATCH',
      '/translate/histories/hist-123',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
  })

  it('logs + toasts `error.save` + rethrows on failure by default, forwarding the body', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useUpdateHistory('hist-123'))

    await expect(result.current({ star: true })).rejects.toBe(failure)
    expect(triggerSpy).toHaveBeenCalledWith({ body: { star: true } })
    expect(loggerSpy).toHaveBeenCalledWith('Failed to update translate history', failure)
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.save)')
  })

  it('rethrowError: false swallows the failure while the hook still logs + toasts', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useUpdateHistory('hist-123', { rethrowError: false }))

    await expect(result.current({ star: false })).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
  })
})
