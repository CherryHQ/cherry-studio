// u4f7fu7528u6a21u62dfu7684ExaClientu800cu4e0du662fu5b9eu9645u7684@agentic/exau4f9du8d56
import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

// u6a21u62dfu7684ExaClientu7c7bu578bu548cu5b9eu73b0
interface ExaSearchResult {
  title?: string
  text?: string
  url?: string
}

interface ExaSearchResponse {
  autopromptString: string
  results: ExaSearchResult[]
}

class MockExaClient {
  private apiKey: string

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey
  }

  async search({ query, numResults }: { query: string; numResults: number }): Promise<ExaSearchResponse> {
    console.log('[Mock] Exa search called with:', query, numResults)

    // u8fd4u56deu6a21u62dfu7ed3u679c
    return {
      autopromptString: query,
      results: [
        {
          title: 'u6a21u62dfu641cu7d22u7ed3u679c',
          text: `u8fd9u662fu6a21u62dfu7684Exau641cu7d22u7ed3u679cu3002u67e5u8be2: ${query}`,
          url: 'https://example.com/search'
        }
      ]
    }
  }
}

// u4f7fu7528u6a21u62dfu7684ExaClientu66ffu4ee3u5b9eu9645u7684u5916u90e8u4f9du8d56
const ExaClient = MockExaClient

export default class ExaProvider extends BaseWebSearchProvider {
  private exa: MockExaClient

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!provider.apiKey) {
      throw new Error('API key is required for Exa provider')
    }
    this.exa = new ExaClient({ apiKey: provider.apiKey })
  }

  public async search(query: string, maxResults: number): Promise<WebSearchResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const response = await this.exa.search({
        query,
        numResults: Math.max(1, maxResults)
      })

      return {
        query: response.autopromptString,
        results: response.results.map((result) => ({
          title: result.title || 'No title',
          content: result.text || '',
          url: result.url || ''
        }))
      }
    } catch (error) {
      console.error('Exa search failed:', error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
