import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useAddLanguage } from '../useAddLanguage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useAddLanguage', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
  const input = { langCode: 'xx-yy' as const, value: 'Custom', emoji: '🏳️' }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against POST /translate/languages with the correct refresh key', () => {
    renderHook(() => useAddLanguage())

    expect(mockUseMutation).toHaveBeenCalledWith(
      'POST',
      '/translate/languages',
      expect.objectContaining({ refresh: ['/translate/languages'] })
    )
  })

  it('emits a success toast on the happy path (per-hook default `showSuccessToast: true`)', async () => {
    const triggerSpy = vi.fn().mockResolvedValue({ id: 'ok' })
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useAddLanguage())

    await expect(result.current(input)).resolves.toEqual({ id: 'ok' })
    expect(triggerSpy).toHaveBeenCalledWith({ body: input })
    expect(toast.success).toHaveBeenCalledWith('t(settings.translate.custom.success.add)')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('logs + toasts error + rethrows on failure by default', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useAddLanguage())

    await expect(result.current(input)).rejects.toBe(failure)
    expect(loggerSpy).toHaveBeenCalledWith('Failed to add translate language', failure)
    expect(toast.error).toHaveBeenCalledWith('t(settings.translate.custom.error.add)')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
