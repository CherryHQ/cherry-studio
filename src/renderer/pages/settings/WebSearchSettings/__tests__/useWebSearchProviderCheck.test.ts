import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { IpcError } from '@shared/ipc/errors/IpcError'

const { ipcRequestMock, translateMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn(), translateMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

import { useWebSearchProviderCheck } from '../hooks/useWebSearchProviderCheck'

vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next')
  const { default: en } = await import('@renderer/i18n/locales/en-us.json')
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    initImmediate: false,
    keySeparator: false,
    interpolation: { escapeValue: false }
  })
  translateMock.mockImplementation(i18n.t.bind(i18n))
  return { useTranslation: () => ({ t: translateMock }) }
})

const tavilyProvider: WebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  apiKeys: ['key'],
  capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const fetchProvider: WebSearchProvider = {
  id: 'fetch',
  name: 'fetch',
  type: 'api',
  apiKeys: [],
  capabilities: [{ feature: 'fetchUrls' }],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

describe('useWebSearchProviderCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequestMock.mockResolvedValue({ results: [] })
  })

  it('checks keyword providers through the web search IpcApi route', async () => {
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords' })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('web_search.search_keywords', {
      providerId: 'tavily',
      keywords: ['Cherry Studio']
    })
    expect(toast.success).toHaveBeenCalledWith('Verification successful')
  })

  it('includes provider check failure details in the toast', async () => {
    ipcRequestMock.mockRejectedValueOnce(new Error('missing API key'))
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords' })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(toast.error).toHaveBeenCalledWith('Verification failed: missing API key')
  })

  it.each([
    [
      'querit',
      'fetchUrls',
      'web_search.fetch_urls',
      { providerId: 'querit', urls: ['https://www.querit.ai/en/docs/overview/about'] }
    ],
    ['jina', 'fetchUrls', 'web_search.fetch_urls', { providerId: 'jina', urls: ['https://example.com'] }],
    ['querit', 'searchKeywords', 'web_search.search_keywords', { providerId: 'querit', keywords: ['Cherry Studio'] }]
  ] as const)('checks %s %s with the capability-specific probe', async (id, capability, route, request) => {
    const { result } = renderHook(() => useWebSearchProviderCheck({ provider: { ...tavilyProvider, id }, capability }))
    await act(async () => {
      await result.current.checkProvider()
    })
    expect(ipcRequestMock).toHaveBeenCalledWith(route, request)
    expect(toast.success).toHaveBeenCalledWith('Verification successful')
    expect(result.current.checking).toBe(false)
  })

  it('explains a page failure with the actual probe URL and restores the check action', async () => {
    let rejectCheck!: (error: Error) => void
    ipcRequestMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCheck = reject
        })
    )
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({
        provider: { ...tavilyProvider, id: 'querit' },
        capability: 'fetchUrls'
      })
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.checkProvider()
    })
    expect(result.current.checking).toBe(true)
    await act(async () => {
      rejectCheck(new IpcError('WEB_SEARCH_PAGE_FETCH_FAILED', 'Provider diagnostic'))
      await pending
    })
    expect(translateMock).toHaveBeenCalledWith('settings.tool.websearch.check_page_fetch_failed', {
      url: 'https://www.querit.ai/en/docs/overview/about'
    })
    expect(toast.error).toHaveBeenCalledWith({
      title: 'Verification failed',
      description:
        'Querit responded, but could not fetch the test page (https://www.querit.ai/en/docs/overview/about). URL fetching was not verified.'
    })
    expect(result.current.checking).toBe(false)
    expect(result.current.canCheck).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([
    new IpcError('INTERNAL', 'offline'),
    new IpcError('INTERNAL', 'Invalid credential'),
    new IpcError('INTERNAL', 'Querit contents returned empty content'),
    Object.assign(new Error('plain error with matching code'), { code: 'WEB_SEARCH_PAGE_FETCH_FAILED' })
  ])('keeps the generic failure composition for $message', async (error) => {
    ipcRequestMock.mockRejectedValueOnce(error)
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({
        provider: { ...tavilyProvider, id: 'querit' },
        capability: 'fetchUrls'
      })
    )
    await act(async () => {
      await result.current.checkProvider()
    })
    expect(toast.error).toHaveBeenCalledWith(`Verification failed: ${error.message}`)
    expect(result.current.checking).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('disables checks for zero-config fetch provider panels', () => {
    const { result } = renderHook(() => useWebSearchProviderCheck({ provider: fetchProvider, capability: 'fetchUrls' }))

    expect(result.current.canCheck).toBe(false)

    act(() => {
      void result.current.checkProvider()
    })

    expect(ipcRequestMock).not.toHaveBeenCalled()
  })
})
