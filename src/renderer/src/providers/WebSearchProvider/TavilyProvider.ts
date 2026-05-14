import { TavilyClient } from '@agentic/tavily'
import { loggerService } from '@logger'
import type { WebSearchState } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('TavilyProvider')
export default class TavilyProvider extends BaseWebSearchProvider {
  private tvly: TavilyClient
  // Gate 1: provider-level switch (default enabled)
  private includeRawContent: boolean

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Tavily provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Tavily provider')
    }
    this.tvly = new TavilyClient({ apiKey: this.apiKey, apiBaseUrl: this.apiHost })
    this.includeRawContent = provider.includeRawContent !== false
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      // Double gate: Gate 1 (provider config) AND Gate 2 (per-request, default false)
      const shouldIncludeRawContent = this.includeRawContent && websearch.fullContent === true

      const result = await this.tvly.search({
        query,
        max_results: Math.max(1, websearch.maxResults),
        ...(shouldIncludeRawContent ? { include_raw_content: true } : {})
      })
      return {
        query: result.query,
        results: result.results.slice(0, websearch.maxResults).map((item) => {
          return {
            title: item.title || 'No title',
            content: shouldIncludeRawContent && item.raw_content ? item.raw_content : item.content || '',
            url: item.url || ''
          }
        })
      }
    } catch (error) {
      logger.error('Tavily search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
