import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('OllamaProvider')

export default class OllamaProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Ollama provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Ollama provider')
    }
  }

  public async search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit
  ): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const maxResults = Math.min(Math.max(1, websearch.maxResults), 10)

      const response = await fetch(`${this.apiHost}/web_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders()
        },
        body: JSON.stringify({
          query,
          max_results: maxResults
        }),
        ...httpOptions
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (!data.results || !Array.isArray(data.results)) {
        throw new Error('Invalid response format from Ollama API')
      }

      return {
        query,
        results: data.results.slice(0, websearch.maxResults).map((result: any) => ({
          title: result.title || 'No title',
          content: result.content || '',
          url: result.url || ''
        }))
      }
    } catch (error) {
      logger.error('Ollama search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
