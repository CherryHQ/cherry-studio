import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { act, renderHook } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebSearchProviderCheck } from '../hooks/useWebSearchProviderCheck'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
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
  const searchKeywordsMock = vi.fn()
  const fetchUrlsMock = vi.fn()
  const toastSuccessMock = vi.fn()
  const toastErrorMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      api: {
        ...window.api,
        webSearch: {
          searchKeywords: searchKeywordsMock,
          fetchUrls: fetchUrlsMock
        }
      },
      toast: {
        ...window.toast,
        success: toastSuccessMock,
        error: toastErrorMock
      }
    })
    searchKeywordsMock.mockResolvedValue({ results: [] })
    fetchUrlsMock.mockResolvedValue({ results: [] })
  })

  it('checks keyword providers through the existing web search IPC', async () => {
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords' })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(searchKeywordsMock).toHaveBeenCalledWith({ providerId: 'tavily', keywords: ['Cherry Studio'] })
    expect(toastSuccessMock).toHaveBeenCalledWith('settings.tool.websearch.check_success')
  })

  it('includes provider check failure details in the toast', async () => {
    searchKeywordsMock.mockRejectedValueOnce(new Error('missing API key'))
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords' })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.check_failed: missing API key')
  })

  it('disables checks for zero-config fetch provider panels', () => {
    const { result } = renderHook(() => useWebSearchProviderCheck({ provider: fetchProvider, capability: 'fetchUrls' }))

    expect(result.current.canCheck).toBe(false)

    act(() => {
      void result.current.checkProvider()
    })

    expect(fetchUrlsMock).not.toHaveBeenCalled()
  })
})
