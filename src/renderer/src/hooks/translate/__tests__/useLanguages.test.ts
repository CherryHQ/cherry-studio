import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useLanguages } from '../useLanguages'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

const languagesFixture = [
  { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
  { langCode: 'zh-cn', value: '中文', emoji: '🇨🇳' }
]

describe('useLanguages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('toasts a user-visible error exactly once across re-renders when the query fails', () => {
    const err = new Error('IPC down')
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: undefined,
          isLoading: false,
          isRefreshing: false,
          error: err,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { rerender } = renderHook(() => useLanguages())
    rerender()
    rerender()

    expect(loggerSpy).toHaveBeenCalledWith('Failed to load translate languages', err)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('t(translate.error.languages_load_failed)')
  })

  it('getLabel logs a warning when called with an invalid lang code string', () => {
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: languagesFixture,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    const warnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useLanguages())

    // `NOT-A-CODE` fails isTranslateLangCode → falls back to UNKNOWN silently in the old
    // code path; we now warn to surface the malformed upstream value.
    result.current.getLabel('NOT-A-CODE' as any)

    expect(warnSpy).toHaveBeenCalledWith('getLabel received an invalid lang code, falling back to UNKNOWN', {
      lang: 'NOT-A-CODE'
    })
  })

  it('getLabel stays silent when called with null (legitimate UI sentinel)', () => {
    mockUseQuery.mockImplementation(
      () =>
        ({
          data: languagesFixture,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }) as any
    )
    const warnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useLanguages())

    result.current.getLabel(null)

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
