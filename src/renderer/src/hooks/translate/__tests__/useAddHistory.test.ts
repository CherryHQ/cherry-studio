import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useAddHistory } from '../useAddHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useAddHistory', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
  const historyInput = {
    sourceText: 'Hello',
    targetText: '你好',
    sourceLanguage: 'en-us' as const,
    targetLanguage: 'zh-cn' as const
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against POST /translate/histories with the correct refresh key', () => {
    renderHook(() => useAddHistory())

    expect(mockUseMutation).toHaveBeenCalledWith(
      'POST',
      '/translate/histories',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
  })

  it('logs + toasts + rethrows on failure by default, forwarding the body to trigger', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useAddHistory())

    await expect(result.current(historyInput)).rejects.toBe(failure)
    expect(triggerSpy).toHaveBeenCalledWith({ body: historyInput })
    expect(loggerSpy).toHaveBeenCalledWith('Failed to add translate history', failure)
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.add)')
    // Default `showSuccessToast: false` — no success toast even on the success path.
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('suppresses the error toast when showErrorToast: false while still logging', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useAddHistory({ showErrorToast: false }))

    await expect(result.current(historyInput)).rejects.toBe(failure)
    expect(loggerSpy).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('coerces the UNKNOWN sentinel to null on both language fields before calling trigger', async () => {
    const triggerSpy = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useAddHistory())

    await result.current({
      sourceText: 'Hello',
      targetText: '你好',
      sourceLanguage: 'unknown',
      targetLanguage: 'unknown'
    })

    expect(triggerSpy).toHaveBeenCalledWith({
      body: {
        sourceText: 'Hello',
        targetText: '你好',
        sourceLanguage: null,
        targetLanguage: null
      }
    })
  })

  it('passes concrete lang codes and explicit null through unchanged', async () => {
    const triggerSpy = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useAddHistory())

    await result.current({
      sourceText: 'Hello',
      targetText: '你好',
      sourceLanguage: 'en-us',
      targetLanguage: null
    })

    expect(triggerSpy).toHaveBeenCalledWith({
      body: {
        sourceText: 'Hello',
        targetText: '你好',
        sourceLanguage: 'en-us',
        targetLanguage: null
      }
    })
  })
})
