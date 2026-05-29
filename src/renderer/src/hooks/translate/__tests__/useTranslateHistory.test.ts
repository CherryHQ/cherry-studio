import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../tests/__mocks__/RendererLoggerService'
import { useTranslateHistory } from '../useTranslateHistory'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

describe('useTranslateHistory', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('registers history CRUD mutations with shared refresh keys', () => {
    renderHook(() => useTranslateHistory())

    expect(mockUseMutation).toHaveBeenCalledWith(
      'POST',
      '/translate/histories',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
    expect(mockUseMutation).toHaveBeenCalledWith(
      'PATCH',
      '/translate/histories/:id',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
    expect(mockUseMutation).toHaveBeenCalledWith(
      'DELETE',
      '/translate/histories/:id',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
    expect(mockUseMutation).toHaveBeenCalledWith(
      'DELETE',
      '/translate/histories',
      expect.objectContaining({ refresh: ['/translate/histories'] })
    )
  })

  it('adds history and coerces UNKNOWN language sentinels to null', async () => {
    const addTrigger = vi.fn().mockResolvedValue({ id: 'h1' })
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/translate/histories') {
        return { trigger: addTrigger, isLoading: false, error: undefined } as any
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined } as any
    })

    const { result } = renderHook(() => useTranslateHistory())

    await result.current.add({
      sourceText: 'Hello',
      targetText: '你好',
      sourceLanguage: 'unknown',
      targetLanguage: 'unknown'
    })

    expect(addTrigger).toHaveBeenCalledWith({
      body: {
        sourceText: 'Hello',
        targetText: '你好',
        sourceLanguage: null,
        targetLanguage: null
      }
    })
  })

  it('updates by id and preserves omitted language fields', async () => {
    const updateTrigger = vi.fn().mockResolvedValue({ id: 'hist-123' })
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'PATCH' && path === '/translate/histories/:id') {
        return { trigger: updateTrigger, isLoading: false, error: undefined } as any
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined } as any
    })

    const { result } = renderHook(() => useTranslateHistory())

    await result.current.update('hist-123', { star: true })
    await result.current.update('hist-456', {
      sourceLanguage: 'unknown',
      targetLanguage: parseTranslateLangCode('en-us')
    })

    expect(updateTrigger).toHaveBeenNthCalledWith(1, { params: { id: 'hist-123' }, body: { star: true } })
    expect(updateTrigger).toHaveBeenNthCalledWith(2, {
      params: { id: 'hist-456' },
      body: { sourceLanguage: null, targetLanguage: 'en-us' }
    })
  })

  it('removes one history item and clears all history through method calls', async () => {
    const removeTrigger = vi.fn().mockResolvedValue(undefined)
    const clearTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'DELETE' && path === '/translate/histories/:id') {
        return { trigger: removeTrigger, isLoading: false, error: undefined } as any
      }
      if (method === 'DELETE' && path === '/translate/histories') {
        return { trigger: clearTrigger, isLoading: false, error: undefined } as any
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined } as any
    })

    const { result } = renderHook(() => useTranslateHistory())

    await result.current.remove('hist-123')
    await result.current.clear()

    expect(removeTrigger).toHaveBeenCalledWith({ params: { id: 'hist-123' } })
    expect(clearTrigger).toHaveBeenCalledWith()
  })

  it('logs, toasts, and optionally swallows mutation failures', async () => {
    const failure = new Error('boom')
    const updateTrigger = vi.fn().mockRejectedValue(failure)
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'PATCH' && path === '/translate/histories/:id') {
        return { trigger: updateTrigger, isLoading: false, error: undefined } as any
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined } as any
    })
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useTranslateHistory({ update: { rethrowError: false } }))

    await expect(result.current.update('hist-123', { star: false })).resolves.toBeUndefined()
    expect(loggerSpy).toHaveBeenCalledWith('Failed to update translate history', failure)
    expect(toast.error).toHaveBeenCalledWith('t(translate.history.error.save)')
  })
})
