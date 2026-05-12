import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSyncZhipuWebSearchApiKeys, useWebSearchProviders, useWebSearchSettings } from '../useWebSearch'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useWebSearch', () => {
  const toastErrorMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    Object.assign(window, {
      toast: {
        ...window.toast,
        error: toastErrorMock
      }
    })
  })

  it('updates one provider API keys while preserving other provider overrides', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        capabilities: {
          searchKeywords: {
            apiHost: 'https://custom.zhipu.dev'
          }
        }
      }
    })

    const { result } = renderHook(() => useWebSearchProviders())

    await act(async () => {
      await result.current.setApiKeys('zhipu', [' zhipu-key '])
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toEqual({
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiKeys: ['zhipu-key'],
        capabilities: {
          searchKeywords: {
            apiHost: 'https://custom.zhipu.dev'
          }
        }
      }
    })
  })

  it('updates one provider capability host through dedicated setters', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      searxng: {
        capabilities: {
          searchKeywords: {
            apiHost: 'https://search.example.com'
          }
        }
      }
    })

    const { result } = renderHook(() => useWebSearchProviders())

    await act(async () => {
      await result.current.setCapabilityApiHost('searxng', 'searchKeywords', ' https://search.internal.test ')
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.provider_overrides')).toEqual({
      searxng: {
        capabilities: {
          searchKeywords: {
            apiHost: 'https://search.internal.test'
          }
        }
      }
    })
  })

  it('updates default providers through separate capability preference keys', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      tavily: {
        apiKeys: ['tavily-key']
      }
    })

    const { result } = renderHook(() => useWebSearchProviders())
    const tavily = result.current.getProvider('tavily')!
    const fetch = result.current.getProvider('fetch')!

    await act(async () => {
      await result.current.setDefaultSearchKeywordsProvider(tavily)
      await result.current.setDefaultFetchUrlsProvider(fetch)
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.default_search_keywords_provider')).toBe('tavily')
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.default_fetch_urls_provider')).toBe('fetch')
  })

  it('shows a Zhipu web search sync failure toast when syncing LLM API keys fails', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
    MockUsePreferenceUtils.mockPreferenceError('chat.web_search.provider_overrides', new Error('persist failed'))
    const { result } = renderHook(() => useSyncZhipuWebSearchApiKeys())

    act(() => {
      result.current('zhipu', 'zhipu-key')
    })

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.errors.zhipu_sync_failed')
    })
  })

  it('updates web search blacklist domains through settings', async () => {
    const { result } = renderHook(() => useWebSearchSettings())

    await act(async () => {
      await result.current.setExcludeDomains(['example.com', '/.*\\.test$/'])
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.exclude_domains')).toEqual([
      'example.com',
      '/.*\\.test$/'
    ])
  })

  it('updates compression preferences through useMultiplePreferences', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.web_search.exclude_domains': [],
      'chat.web_search.max_results': 5,
      'chat.web_search.compression.method': 'cutoff',
      'chat.web_search.compression.cutoff_limit': 2000
    })

    const { result } = renderHook(() => useWebSearchSettings())

    await act(async () => {
      await result.current.updateCompressionConfig({ cutoffLimit: 3000 })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_limit')).toBe(3000)
  })

  it('keeps the current cutoff limit when compression updates pass undefined', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.web_search.exclude_domains': [],
      'chat.web_search.max_results': 5,
      'chat.web_search.compression.method': 'cutoff',
      'chat.web_search.compression.cutoff_limit': 5000
    })

    const { result } = renderHook(() => useWebSearchSettings())

    await act(async () => {
      await result.current.updateCompressionConfig({ method: 'none', cutoffLimit: undefined })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.method')).toBe('none')
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_limit')).toBe(5000)
  })

  it('exposes normalized web search settings state', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.web_search.exclude_domains': ['example.com'],
      'chat.web_search.max_results': 0,
      'chat.web_search.compression.method': 'cutoff',
      'chat.web_search.compression.cutoff_limit': null
    })

    const { result } = renderHook(() => useWebSearchSettings())

    expect(result.current.maxResults).toBe(1)
    expect(result.current.excludeDomains).toEqual(['example.com'])
    expect(result.current.compressionConfig).toEqual({
      method: 'cutoff',
      cutoffLimit: 2000
    })
  })
})
