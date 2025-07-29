import { TavilyClient } from '@agentic/tavily'
import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('TavilyProvider')
export default class TavilyProvider extends BaseWebSearchProvider {
  private tvly: TavilyClient

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Tavily provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Tavily provider')
    }
    this.tvly = new TavilyClient({ apiKey: this.apiKey, apiBaseUrl: this.apiHost })
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const result = await this.tvly.search({
        query,
        max_results: Math.max(1, websearch.maxResults)
      })
      return {
        query: result.query,
        results: result.results.slice(0, websearch.maxResults).map((result) => {
          return {
            title: result.title || 'No title',
            content: result.content || '',
            url: result.url || ''
          }
        })
      }
    } catch (error) {
      logger.error('Tavily search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
