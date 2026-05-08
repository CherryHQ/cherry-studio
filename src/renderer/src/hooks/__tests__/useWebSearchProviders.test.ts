import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useUpdateWebSearchProviderOverride, useWebSearchSettings } from '../useWebSearchProviders'

describe('useWebSearchProviders', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('updates one provider override through usePreference while preserving other providers', async () => {
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

    const { result } = renderHook(() => useUpdateWebSearchProviderOverride())

    await act(async () => {
      await result.current('zhipu', { apiKey: 'zhipu-key' })
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

  it('updates compression preferences through useMultiplePreferences', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.web_search.default_search_keywords_provider': null,
      'chat.web_search.default_fetch_urls_provider': 'fetch',
      'chat.web_search.exclude_domains': [],
      'chat.web_search.max_results': 5,
      'chat.web_search.provider_overrides': {},
      'chat.web_search.subscribe_sources': [],
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
})
