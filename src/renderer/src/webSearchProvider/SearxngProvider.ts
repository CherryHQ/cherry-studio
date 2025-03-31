import { SearxngClient } from '@agentic/searxng'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchResponse } from '@renderer/types'
import axios from 'axios'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class SearxngProvider extends BaseWebSearchProvider {
  private searxng: SearxngClient
  private engines: string[] = []
  private readonly apiHost: string
  private isInitialized = false

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!provider.apiHost) {
      throw new Error('API host is required for SearxNG provider')
    }
    this.apiHost = provider.apiHost
    this.searxng = new SearxngClient({ apiBaseUrl: this.apiHost })
    this.initEngines().catch((err) => console.error('Failed to initialize SearxNG engines:', err))
  }

  private async initEngines(): Promise<void> {
    try {
      const response = await axios.get(`${this.apiHost}/config`, { timeout: 5000 })

      if (!response.data || !Array.isArray(response.data.engines)) {
        throw new Error('Invalid response format from SearxNG config endpoint')
      }

      this.engines = response.data.engines
        .filter(
          (engine: { enabled: boolean; categories: string[]; name: string }) =>
            engine.enabled &&
            Array.isArray(engine.categories) &&
            engine.categories.includes('general') &&
            engine.categories.includes('web')
        )
        .map((engine) => engine.name)

      this.isInitialized = true
      console.log(`SearxNG initialized with ${this.engines.length} engines`)
    } catch (err) {
      console.error('Failed to fetch SearxNG engine configuration:', err)
      this.engines = []
    }
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchResponse> {
    try {
      if (!query) {
        throw new Error('Search query cannot be empty')
      }

      // Wait for initialization if it's the first search
      if (!this.isInitialized) {
        await this.initEngines().catch(() => {}) // Ignore errors
      }

      // 如果engines为空，直接返回空结果
      if (this.engines.length === 0) {
        return {
          query: query,
          results: []
        }
      }

      const result = await this.searxng.search({
        query: query,
        engines: this.engines as any,
        language: 'auto'
      })

      if (!result || !Array.isArray(result.results)) {
        throw new Error('Invalid search results from SearxNG')
      }
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
    } catch (err) {
      console.error('Search failed:', err)
      // Return empty results instead of throwing to prevent UI crashes
      return {
        query: query,
        results: []
      }
    }
  }
}
