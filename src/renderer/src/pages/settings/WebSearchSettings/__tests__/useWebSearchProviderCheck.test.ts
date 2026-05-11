import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
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

const tavilyProvider: ResolvedWebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  apiKeys: ['key'],
  capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const fetchProvider: ResolvedWebSearchProvider = {
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
    const commitForm = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords', commitForm })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(commitForm).toHaveBeenCalledOnce()
    expect(searchKeywordsMock).toHaveBeenCalledWith({ providerId: 'tavily', keywords: ['Cherry Studio'] })
    expect(toastSuccessMock).toHaveBeenCalledWith('settings.tool.websearch.check_success')
  })

  it('does not call IPC when saving current form values fails', async () => {
    const commitForm = vi.fn().mockRejectedValue(new Error('save failed'))
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: tavilyProvider, capability: 'searchKeywords', commitForm })
    )

    await act(async () => {
      await result.current.checkProvider()
    })

    expect(searchKeywordsMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.check_failed')
  })

  it('disables checks for zero-config fetch provider panels', () => {
    const commitForm = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useWebSearchProviderCheck({ provider: fetchProvider, capability: 'fetchUrls', commitForm })
    )

    expect(result.current.canCheck).toBe(false)

    act(() => {
      void result.current.checkProvider()
    })

    expect(commitForm).not.toHaveBeenCalled()
    expect(fetchUrlsMock).not.toHaveBeenCalled()
  })
})
