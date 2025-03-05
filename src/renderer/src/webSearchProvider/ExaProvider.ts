import { ExaClient } from '@agentic/exa'
import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class ExaProvider extends BaseWebSearchProvider {
  private exa: ExaClient

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!provider.apiKey) {
      throw new Error('API key is required for Tavily provider')
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
