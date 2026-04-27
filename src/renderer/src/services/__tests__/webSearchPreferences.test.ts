import { preferenceService } from '@data/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const webSearchEngineProviderMock = vi.hoisted(() => ({
  search: vi.fn()
}))

vi.mock('@renderer/providers/WebSearchProvider', () => ({
  default: vi.fn().mockImplementation(() => ({
    search: webSearchEngineProviderMock.search
  }))
}))

import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  updateWebSearchProviderPreferenceOverride,
  WebSearchService
} from '../WebSearchService'

const preferenceServiceMock = preferenceService as typeof preferenceService & {
  _resetMockState?: () => void
}

describe('webSearchPreferences', () => {
  beforeEach(() => {
    preferenceServiceMock._resetMockState?.()
    webSearchEngineProviderMock.search.mockReset()
    webSearchEngineProviderMock.search.mockResolvedValue({ results: [] })
  })

  it('resolves renderer providers from preference overrides', () => {
    const providers = resolveWebSearchProviders({
      tavily: {
        apiKeys: [' key-1 ', 'key-2'],
        apiHost: ' https://custom.tavily.dev ',
        engines: ['web'],
        basicAuthUsername: ' user ',
        basicAuthPassword: 'pass'
      }
    })

    expect(providers.find((provider) => provider.id === 'tavily')).toEqual(
      expect.objectContaining({
        id: 'tavily',
        apiKey: 'key-1,key-2',
        apiHost: 'https://custom.tavily.dev',
        engines: ['web'],
        basicAuthUsername: 'user',
        basicAuthPassword: 'pass'
      })
    )
  })

  it('builds preference overrides from renderer providers', () => {
    const overrides = buildWebSearchProviderOverrides([
      {
        id: 'tavily',
        name: 'Tavily',
        apiKey: 'key-1, key-2',
        apiHost: ' https://custom.tavily.dev ',
        engines: ['web'],
        basicAuthUsername: ' user ',
        basicAuthPassword: 'pass'
      }
    ] as any)

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-1', 'key-2'],
      apiHost: 'https://custom.tavily.dev',
      engines: ['web'],
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass'
    })
  })

  it('updates a single provider override without store state', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        tavily: {
          apiKeys: ['key-1']
        }
      },
      'tavily',
      {
        apiKey: 'key-2, key-3',
        apiHost: 'https://custom.tavily.dev'
      } as any
    )

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-2', 'key-3'],
      apiHost: 'https://custom.tavily.dev'
    })
  })

  it('updates provider overrides through PreferenceService while preserving other providers', async () => {
    await preferenceService.set('chat.web_search.provider_overrides', {
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiHost: 'https://custom.zhipu.dev'
      }
    })

    await updateWebSearchProviderPreferenceOverride('zhipu', { apiKey: 'zhipu-key' })

    await expect(preferenceService.get('chat.web_search.provider_overrides')).resolves.toEqual({
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiKeys: ['zhipu-key'],
        apiHost: 'https://custom.zhipu.dev'
      }
    })
  })

  it('keeps explicit empty auth fields when building provider overrides', () => {
    const overrides = buildWebSearchProviderOverrides([
      {
        id: 'tavily',
        name: 'Tavily',
        apiKey: '',
        apiHost: undefined,
        engines: undefined,
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    ] as any)

    expect(overrides).toEqual({
      tavily: {
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    })
  })

  it('keeps provider key when a field is explicitly cleared to empty', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        tavily: {
          apiHost: 'https://custom.tavily.dev'
        }
      },
      'tavily',
      {
        apiHost: ' '
      } as any
    )

    expect(overrides).toEqual({
      tavily: {
        apiHost: ''
      }
    })
  })

  it('builds renderer websearch state from preference snapshot', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: 'bocha',
      excludeDomains: ['example.com'],
      maxResults: 12,
      providerOverrides: {
        tavily: {
          apiKeys: ['key-1']
        }
      },
      searchWithTime: true,
      subscribeSources: [
        {
          key: 1,
          url: 'https://example.com/list.txt',
          name: 'Example',
          blacklist: ['blocked.com']
        }
      ],
      compressionMethod: 'cutoff',
      cutoffLimit: 2000,
      cutoffUnit: 'token'
    })

    expect(state.defaultProvider).toBe('bocha')
    expect(state.searchWithTime).toBe(true)
    expect(state.maxResults).toBe(12)
    expect(state.excludeDomains).toEqual(['example.com'])
    expect(state.subscribeSources).toHaveLength(1)
    expect(state.compressionConfig).toEqual(
      expect.objectContaining({
        method: 'cutoff',
        cutoffLimit: 2000,
        cutoffUnit: 'token'
      })
    )
  })

  it('defaults stale empty cutoff limit when building renderer state', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: null,
      excludeDomains: [],
      maxResults: 10,
      providerOverrides: {},
      searchWithTime: true,
      subscribeSources: [],
      compressionMethod: 'cutoff',
      cutoffLimit: null as any,
      cutoffUnit: 'char'
    })

    expect(state.compressionConfig.cutoffLimit).toBe(2000)
  })

  it('uses the searchWithTime preference regardless of selected provider', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: 'tavily',
      excludeDomains: [],
      maxResults: 5,
      providerOverrides: {},
      searchWithTime: false,
      subscribeSources: [],
      compressionMethod: 'none',
      cutoffLimit: 2000,
      cutoffUnit: 'char'
    })

    expect(state.searchWithTime).toBe(false)
  })

  it('adds current date context to search queries when searchWithTime is enabled', async () => {
    await preferenceService.set('chat.web_search.search_with_time', true)

    const service = new WebSearchService()
    await service.search(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      'latest news'
    )

    expect(webSearchEngineProviderMock.search).toHaveBeenCalledWith(
      expect.stringMatching(/^today is \d{4}-\d{2}-\d{2} \r\n latest news$/),
      expect.objectContaining({ searchWithTime: true }),
      undefined
    )
  })

  it('passes the original search query when searchWithTime is disabled', async () => {
    await preferenceService.set('chat.web_search.search_with_time', false)

    const service = new WebSearchService()
    await service.search(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      'latest news'
    )

    expect(webSearchEngineProviderMock.search).toHaveBeenCalledWith(
      'latest news',
      expect.objectContaining({ searchWithTime: false }),
      undefined
    )
  })
})
