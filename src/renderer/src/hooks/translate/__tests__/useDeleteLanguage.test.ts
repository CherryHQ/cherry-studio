import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useDeleteLanguage } from '../useDeleteLanguage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useDeleteLanguage', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against DELETE /translate/languages/:langCode with the correct refresh key', () => {
    renderHook(() => useDeleteLanguage('xx-yy'))

    expect(mockUseMutation).toHaveBeenCalledWith(
      'DELETE',
      '/translate/languages/xx-yy',
      expect.objectContaining({ refresh: ['/translate/languages'] })
    )
  })

  it('emits a success toast on the happy path (per-hook default `showSuccessToast: true`)', async () => {
    const triggerSpy = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useDeleteLanguage('xx-yy'))

    await expect(result.current()).resolves.toBeUndefined()
    expect(toast.success).toHaveBeenCalledWith('t(settings.translate.custom.success.delete)')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('logs + toasts error + rethrows on failure by default', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useDeleteLanguage('xx-yy'))

    await expect(result.current()).rejects.toBe(failure)
    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete translate language', failure)
    expect(toast.error).toHaveBeenCalledWith('t(settings.translate.custom.error.delete)')
  })
})
