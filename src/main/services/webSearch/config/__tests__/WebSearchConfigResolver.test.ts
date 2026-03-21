import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { WebSearchConfigResolver } from '../WebSearchConfigResolver'

const preferenceValues: Record<string, unknown> = {
  'chat.web_search.search_with_time': true,
  'chat.web_search.max_results': 5,
  'chat.web_search.exclude_domains': ['example.com'],
  'chat.web_search.compression.method': 'none',
  'chat.web_search.compression.cutoff_limit': null,
  'chat.web_search.compression.cutoff_unit': 'char',
  'chat.web_search.compression.rag_document_count': 5,
  'chat.web_search.compression.rag_embedding_model_id': null,
  'chat.web_search.compression.rag_embedding_dimensions': null,
  'chat.web_search.compression.rag_rerank_model_id': null,
  'chat.web_search.provider_overrides': {
    tavily: {
      apiKey: 'tavily-key'
    }
  }
}

const mockPreferenceReader = {
  async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
    return preferenceValues[key] as PreferenceDefaultScopeType[K]
  }
}

describe('WebSearchConfigResolver', () => {
  it('resolves all supported provider types from layered presets + overrides by default', async () => {
    const resolver = new WebSearchConfigResolver(mockPreferenceReader)

    const resolved = await resolver.getResolvedConfig()
    const providerIds = resolved.providers.map((provider) => provider.id)

    expect(providerIds).toContain('exa-mcp')
    expect(providerIds).toContain('local-google')

    const tavily = resolved.providers.find((provider) => provider.id === 'tavily')
    expect(tavily?.apiKey).toBe('tavily-key')
  })

  it('returns runtime config from flattened preference keys', async () => {
    const resolver = new WebSearchConfigResolver(mockPreferenceReader)

    const runtime = await resolver.getRuntimeConfig()

    expect(runtime.searchWithTime).toBe(true)
    expect(runtime.maxResults).toBe(5)
    expect(runtime.excludeDomains).toEqual(['example.com'])
    expect(runtime.compression.method).toBe('none')
  })
})
