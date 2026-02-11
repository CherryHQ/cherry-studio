import { ExaClient } from '@agentic/exa'
import { loggerService } from '@logger'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('ExaProvider')
export default class ExaProvider extends BaseWebSearchProvider {
  private exa: ExaClient

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Exa provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Exa provider')
    }
    this.exa = new ExaClient({ apiKey: this.apiKey, apiBaseUrl: this.apiHost })
  }

  public async search(query: string): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const { maxResults } = await this.getSearchConfig()

      const response = await this.exa.search({
        query,
        numResults: Math.max(1, maxResults),
        contents: {
          text: true
        }
      })

      return {
        query: response.autopromptString,
        results: response.results.slice(0, maxResults).map((result) => {
          return {
            title: result.title || 'No title',
            content: result.text || '',
            url: result.url || ''
          }
        })
      }
    } catch (error) {
      logger.error('Exa search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
