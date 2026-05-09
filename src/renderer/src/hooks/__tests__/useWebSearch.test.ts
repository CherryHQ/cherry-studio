import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWebSearchProviders, useWebSearchSettings } from '../useWebSearch'

describe('useWebSearch', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('updates one provider override while preserving other providers', async () => {
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
      await result.current.updateProviderOverride('zhipu', { apiKeys: ['zhipu-key'] })
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
      'chat.web_search.compression.cutoff_limit': 2000,
      'chat.web_search.compression.cutoff_unit': 'char'
    })

    const { result } = renderHook(() => useWebSearchSettings())

    await act(async () => {
      await result.current.updateCompressionConfig({ cutoffUnit: 'token' })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.compression.cutoff_unit')).toBe('token')
  })

  it('exposes normalized web search settings state', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.web_search.exclude_domains': ['example.com'],
      'chat.web_search.max_results': 0,
      'chat.web_search.compression.method': 'cutoff',
      'chat.web_search.compression.cutoff_limit': null,
      'chat.web_search.compression.cutoff_unit': 'token'
    })

    const { result } = renderHook(() => useWebSearchSettings())

    expect(result.current.maxResults).toBe(1)
    expect(result.current.excludeDomains).toEqual(['example.com'])
    expect(result.current.compressionConfig).toEqual({
      method: 'cutoff',
      cutoffLimit: 2000,
      cutoffUnit: 'token'
    })
  })
})
