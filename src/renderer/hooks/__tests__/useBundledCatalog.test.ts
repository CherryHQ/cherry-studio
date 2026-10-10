import { act, renderHook, waitFor } from '@testing-library/react'
import { Activity, createElement, type PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bundledCatalogMocks = vi.hoisted(() => ({
  error: vi.fn(),
  language: 'en-US',
  resourcesPath: '/resources',
  warn: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => [bundledCatalogMocks.resourcesPath]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: bundledCatalogMocks.error,
      warn: bundledCatalogMocks.warn
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: bundledCatalogMocks.language,
      resolvedLanguage: bundledCatalogMocks.language
    }
  })
}))

import { useBundledCatalog } from '../useBundledCatalog'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

describe('useBundledCatalog', () => {
  beforeEach(() => {
    bundledCatalogMocks.error.mockReset()
    bundledCatalogMocks.language = 'en-US'
    bundledCatalogMocks.resourcesPath = '/resources'
    bundledCatalogMocks.warn.mockReset()
  })

  it('honors enabled and reports loading until the catalog resolves', async () => {
    const deferred = createDeferred<string[]>()
    const load = vi.fn(() => deferred.promise)
    let enabled = false
    const { result, rerender } = renderHook(() =>
      useBundledCatalog({
        catalog: 'test catalog',
        enabled,
        load
      })
    )

    expect(result.current).toEqual({ isLoading: false, items: [] })
    expect(load).not.toHaveBeenCalled()

    enabled = true
    rerender()

    await waitFor(() => expect(result.current.isLoading).toBe(true))
    expect(load).toHaveBeenCalledWith('/resources', 'en-US')

    await act(async () => {
      deferred.resolve(['preset'])
    })

    expect(result.current).toEqual({ isLoading: false, items: ['preset'] })
  })

  it('ignores a stale request after the catalog language changes', async () => {
    const english = createDeferred<string[]>()
    const chinese = createDeferred<string[]>()
    const load = vi.fn((_resourcesPath: string, language: string) =>
      language === 'zh-CN' ? chinese.promise : english.promise
    )
    const { result, rerender } = renderHook(() =>
      useBundledCatalog({
        catalog: 'test catalog',
        load
      })
    )

    await waitFor(() => expect(load).toHaveBeenCalledWith('/resources', 'en-US'))

    bundledCatalogMocks.language = 'zh-CN'
    rerender()
    await waitFor(() => expect(load).toHaveBeenCalledWith('/resources', 'zh-CN'))

    await act(async () => {
      english.resolve(['stale'])
    })
    expect(result.current).toEqual({ isLoading: true, items: [] })

    await act(async () => {
      chinese.resolve(['最新'])
    })
    expect(result.current).toEqual({ isLoading: false, items: ['最新'] })
  })

  it('keeps a loaded catalog stable across an Activity hide and show cycle', async () => {
    const load = vi.fn().mockResolvedValue(['preset'])
    let mode: 'hidden' | 'visible' = 'visible'
    const wrapper = ({ children }: PropsWithChildren) => createElement(Activity, { children, mode })
    const { result, rerender } = renderHook(
      () =>
        useBundledCatalog({
          catalog: 'test catalog',
          load
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.items).toEqual(['preset']))

    mode = 'hidden'
    rerender()
    mode = 'visible'
    rerender()

    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({ isLoading: false, items: ['preset'] })
  })

  it('degrades a failed reload to an empty catalog', async () => {
    const loadError = new Error('broken catalog')
    const load = vi.fn().mockResolvedValueOnce(['preset']).mockRejectedValueOnce(loadError)
    const { result, rerender } = renderHook(() =>
      useBundledCatalog<string>({
        catalog: 'test catalog',
        load
      })
    )

    await waitFor(() => expect(result.current.items).toEqual(['preset']))

    bundledCatalogMocks.language = 'fr-FR'
    rerender()

    await waitFor(() => expect(bundledCatalogMocks.error).toHaveBeenCalled())
    expect(bundledCatalogMocks.error).toHaveBeenCalledWith('Failed to load bundled catalog', {
      catalog: 'test catalog',
      error: loadError
    })
    expect(result.current).toEqual({ isLoading: false, items: [] })
  })

  it('waits for the resources path without invoking the domain loader', () => {
    bundledCatalogMocks.resourcesPath = ''
    const load = vi.fn()
    const { result } = renderHook(() =>
      useBundledCatalog({
        catalog: 'test catalog',
        load
      })
    )

    expect(load).not.toHaveBeenCalled()
    expect(bundledCatalogMocks.warn).toHaveBeenCalledWith('Bundled catalog resources path is not ready', {
      catalog: 'test catalog'
    })
    expect(result.current).toEqual({ isLoading: false, items: [] })
  })
})
