import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useTranslateLanguages } from '../useTranslateLanguages'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

const languagesFixture = [
  { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
  { langCode: 'zh-cn', value: '中文', emoji: '🇨🇳' }
]

describe('useTranslateLanguages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('loads languages and exposes label helpers', () => {
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

    const { result } = renderHook(() => useTranslateLanguages())

    expect(result.current.status).toBe('ready')
    expect(result.current.languages).toHaveLength(2)
    expect(result.current.getLabel('en-us')).toBe('🇺🇸 t(languages.english)')
    expect(result.current.getLanguage('zh-cn')?.langCode).toBe('zh-cn')
  })

  it('toasts a user-visible load error exactly once across re-renders', () => {
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

    const { rerender, result } = renderHook(() => useTranslateLanguages())
    rerender()
    rerender()

    expect(result.current.status).toBe('error')
    expect(loggerSpy).toHaveBeenCalledWith('Failed to load translate languages', err)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('t(translate.error.languages_load_failed)')
  })

  it('logs a warning for invalid lang code strings but stays silent for null', () => {
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

    const { result } = renderHook(() => useTranslateLanguages())

    result.current.getLabel('NOT-A-CODE' as any)
    result.current.getLabel(null)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('getLabel received an invalid lang code, falling back to UNKNOWN', {
      lang: 'NOT-A-CODE'
    })
  })

  it('adds, updates, and removes languages through method calls', async () => {
    const addTrigger = vi.fn().mockResolvedValue({ langCode: 'xx-yy' })
    const updateTrigger = vi.fn().mockResolvedValue({ langCode: 'xx-yy' })
    const removeTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/translate/languages') {
        return { trigger: addTrigger, isLoading: false, error: undefined } as any
      }
      if (method === 'PATCH' && path === '/translate/languages/:langCode') {
        return { trigger: updateTrigger, isLoading: false, error: undefined } as any
      }
      if (method === 'DELETE' && path === '/translate/languages/:langCode') {
        return { trigger: removeTrigger, isLoading: false, error: undefined } as any
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined } as any
    })

    const { result } = renderHook(() => useTranslateLanguages())

    await result.current.add({ langCode: 'xx-yy', value: 'Test', emoji: '🏳️' } as any)
    await result.current.update('xx-yy', { value: 'Updated', emoji: '✅' })
    await result.current.remove('xx-yy')

    expect(addTrigger).toHaveBeenCalledWith({ body: { langCode: 'xx-yy', value: 'Test', emoji: '🏳️' } })
    expect(updateTrigger).toHaveBeenCalledWith({
      params: { langCode: 'xx-yy' },
      body: { value: 'Updated', emoji: '✅' }
    })
    expect(removeTrigger).toHaveBeenCalledWith({ params: { langCode: 'xx-yy' } })
  })

  it('keeps rethrow semantics for invalid update and remove calls', async () => {
    const { result } = renderHook(() => useTranslateLanguages())

    await expect(result.current.update(undefined, { value: 'Updated' })).rejects.toThrow(
      'useTranslateLanguages.update: langCode must be set when triggering update'
    )
    await expect(result.current.remove('')).rejects.toThrow(
      'useTranslateLanguages.remove: langCode must be non-empty when triggering delete'
    )
  })
})
