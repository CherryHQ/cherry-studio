import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import { useTranslateLanguages } from '../useTranslateLanguages'
import { setLanguagesQuery } from './testUtils'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

const languagesFixture = [
  { langCode: 'en-us', value: 'English', emoji: '🇺🇸' },
  { langCode: 'zh-cn', value: '中文', emoji: '🇨🇳' }
]

describe('useTranslateLanguages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads languages and exposes label helpers', () => {
    setLanguagesQuery(languagesFixture)

    const { result } = renderHook(() => useTranslateLanguages())

    expect(result.current.status).toBe('ready')
    expect(result.current.languages).toHaveLength(2)
    expect(result.current.getLabel('en-us')).toBe('🇺🇸 t(languages.english)')
    expect(result.current.getLanguage('zh-cn')?.langCode).toBe('zh-cn')
  })

  it('toasts a user-visible load error exactly once across re-renders', () => {
    const err = new Error('IPC down')
    setLanguagesQuery(undefined, { error: err })

    const { rerender, result } = renderHook(() => useTranslateLanguages())
    rerender()
    rerender()

    expect(result.current.status).toBe('error')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('t(translate.error.languages_load_failed)')
  })

  it('adds, updates, and removes languages through method calls', async () => {
    const addTrigger = vi.fn().mockResolvedValue({ langCode: 'xx-yy' })
    const updateTrigger = vi.fn().mockResolvedValue({ langCode: 'xx-yy' })
    const removeTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/translate/languages') {
        return { trigger: addTrigger, isLoading: false, error: undefined }
      }
      if (method === 'PATCH' && path === '/translate/languages/:langCode') {
        return { trigger: updateTrigger, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/translate/languages/:langCode') {
        return { trigger: removeTrigger, isLoading: false, error: undefined }
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined }
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
