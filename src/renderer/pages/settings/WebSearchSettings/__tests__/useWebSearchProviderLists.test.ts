import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWebSearchProviderLists } from '../hooks/useWebSearchProviderLists'

describe('useWebSearchProviderLists', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {})
  })

  it('exposes providers grouped into feature sections', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'tavily')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_fetch_urls_provider', 'fetch')

    const { result } = renderHook(() => useWebSearchProviderLists())

    expect(result.current.featureSections.find((section) => section.capability === 'searchKeywords')?.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'searchKeywords:jina' })])
    )
    expect(result.current.featureSections.find((section) => section.capability === 'fetchUrls')?.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'fetchUrls:jina' })])
    )
  })

  it('restores Yuanbao as the selected keyword provider without offering it for URL fetching', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'yuanbao')
    MockUsePreferenceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      yuanbao: { apiKeys: ['saved-key'] }
    })
    const { result } = renderHook(() => useWebSearchProviderLists())
    expect(result.current.defaultSearchKeywordsProvider).toMatchObject({ id: 'yuanbao', apiKeys: ['saved-key'] })
    expect(
      result.current.featureSections
        .find((section) => section.capability === 'searchKeywords')
        ?.entries.some((entry) => entry.provider.id === 'yuanbao')
    ).toBe(true)
    expect(
      result.current.featureSections
        .find((section) => section.capability === 'fetchUrls')
        ?.entries.some((entry) => entry.provider.id === 'yuanbao')
    ).toBe(false)
  })
})
