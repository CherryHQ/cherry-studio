import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useClearHistory } from '../useClearHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useClearHistory', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against DELETE /translate/histories with the correct refresh key', () => {
    renderHook(() => useClearHistory())

    expect(mockUseMutation).toHaveBeenCalledWith(
      'DELETE',
      '/translate/histories',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
  })

  it('logs + toasts + rethrows on failure by default', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useClearHistory())

    await expect(result.current()).rejects.toBe(failure)
    expect(loggerSpy).toHaveBeenCalledWith('Failed to clear translate history', failure)
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.clear)')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('swallows the error (no rethrow) when rethrowError: false while still logging and toasting', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useClearHistory({ rethrowError: false }))

    await expect(result.current()).resolves.toBeUndefined()
    expect(loggerSpy).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.clear)')
  })
})
