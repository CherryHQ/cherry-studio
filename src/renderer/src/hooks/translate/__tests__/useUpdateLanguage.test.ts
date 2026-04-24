import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useUpdateLanguage } from '../useUpdateLanguage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `t(${key})`
  })
}))

describe('useUpdateLanguage', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers the mutation against the template path with the correct refresh key', () => {
    renderHook(() => useUpdateLanguage('xx-yy'))

    expect(mockUseMutation).toHaveBeenCalledWith(
      'PATCH',
      '/translate/languages/:langCode',
      expect.objectContaining({ refresh: ['/translate/languages'] })
    )
  })

  it('does not wire optimisticData (dead `currentData` parameter removed)', () => {
    renderHook(() => useUpdateLanguage('xx-yy'))

    const options = (mockUseMutation as any).mock.calls[0][2]
    expect(options).not.toHaveProperty('optimisticData')
  })

  it('passes the langCode through trigger params so the SWR key stays stable', async () => {
    const triggerSpy = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useUpdateLanguage('xx-yy'))
    await result.current({ value: 'New', emoji: '🌐' })

    expect(triggerSpy).toHaveBeenCalledWith({
      params: { langCode: 'xx-yy' },
      body: { value: 'New', emoji: '🌐' }
    })
  })

  it('throws fast when triggered with an empty langCode instead of issuing a malformed request', async () => {
    const triggerSpy = vi.fn()
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)

    const { result } = renderHook(() => useUpdateLanguage(''))

    await expect(result.current({ value: 'New', emoji: '🌐' })).rejects.toThrow(/langCode must be non-empty/)
    expect(triggerSpy).not.toHaveBeenCalled()
  })

  it('logs + toasts `error.update` + rethrows on failure by default', async () => {
    const failure = new Error('boom')
    const triggerSpy = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementationOnce(() => ({ trigger: triggerSpy, isLoading: false, error: undefined }) as any)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useUpdateLanguage('xx-yy'))

    await expect(result.current({ value: 'New', emoji: '🌐' })).rejects.toBe(failure)
    expect(triggerSpy).toHaveBeenCalledWith({
      params: { langCode: 'xx-yy' },
      body: { value: 'New', emoji: '🌐' }
    })
    expect(loggerSpy).toHaveBeenCalledWith('Failed to update translate language', failure)
    expect(toast.error).toHaveBeenCalledWith('t(settings.translate.custom.error.update)')
  })
})
