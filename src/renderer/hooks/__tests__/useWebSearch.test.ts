import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebSearchProviders, useWebSearchSettings } from '../useWebSearch'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useWebSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', { keys: [] })
    MockUsePreferenceUtils.resetMocks()
  })

  it('inherits enabled Zhipu model provider API keys when web search keys are empty', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: [] }
    })
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', {
      keys: [{ id: 'zhipu-key', key: ' model-provider-key ', isEnabled: true }]
    })

    const { result } = renderHook(() => useWebSearchProviders())

    expect(result.current.getProvider('zhipu')?.apiKeys).toEqual(['model-provider-key'])
  })

  it('uses enabled Zhipu model provider API keys instead of stale web search keys', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: ['stale-web-search-key'] }
    })
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/api-keys', {
      keys: [{ id: 'zhipu-key', key: 'current-model-provider-key', isEnabled: true }]
    })

    const { result } = renderHook(() => useWebSearchProviders())

    expect(result.current.getProvider('zhipu')?.apiKeys).toEqual(['current-model-provider-key'])
  })

  it('ignores stale Zhipu web search keys when the model provider has no enabled keys', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: ['stale-web-search-key'] }
    })

    const { result } = renderHook(() => useWebSearchProviders())

    expect(result.current.getProvider('zhipu')?.apiKeys).toEqual([])
  })

  it('waits for Zhipu model provider API keys even when stale web search keys exist', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      zhipu: { apiKeys: ['stale-web-search-key'] }
    })
    MockUseDataApiUtils.mockQueryLoading('/providers/:providerId/api-keys')

    const { result } = renderHook(() => useWebSearchProviders())

    expect(result.current.isLoading).toBe(true)
    expect(result.current.providers).toEqual([])
    expect(result.current.defaultSearchKeywordsProvider).toBeUndefined()
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
