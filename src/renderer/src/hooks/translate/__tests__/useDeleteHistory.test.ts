import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useDeleteHistory } from '../useDeleteHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useDeleteHistory', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against DELETE /translate/histories/:id with the correct refresh key', () => {
    renderHook(() => useDeleteHistory('hist-123'))

    expect(mockUseMutation).toHaveBeenCalledWith(
      'DELETE',
      '/translate/histories/hist-123',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
  })

  it('logs + toasts + rethrows on failure by default', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDeleteHistory('hist-123'))

    await expect(result.current()).rejects.toBe(failure)
    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete translate history', failure)
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.delete)')
  })

  it('rethrowError: false swallows the failure while still logging + toasting', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDeleteHistory('hist-123', { rethrowError: false }))

    await expect(result.current()).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
  })
})
