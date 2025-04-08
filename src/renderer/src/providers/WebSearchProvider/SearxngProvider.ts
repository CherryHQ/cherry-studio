import { SearxngClient } from '@agentic/searxng'
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
    try {
      this.searxng = new SearxngClient({ apiBaseUrl: this.apiHost })
    } catch (error) {
      throw new Error(
        `Failed to initialize SearxNG client: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
    this.initEngines().catch((err) => console.error('Failed to initialize SearxNG engines:', err))
  }
  private async initEngines(): Promise<void> {
    try {
      console.log(`Initializing SearxNG with API host: ${this.apiHost}`)
      const response = await axios.get(`${this.apiHost}/config`, {
        timeout: 5000,
        validateStatus: (status) => status === 200 // 仅接受 200 状态码
      })

      if (!response.data) {
        throw new Error('Empty response from SearxNG config endpoint')
      }

      if (!Array.isArray(response.data.engines)) {
        throw new Error('Invalid response format: "engines" property not found or not an array')
      }

      const allEngines = response.data.engines
      console.log(`Found ${allEngines.length} total engines in SearxNG`)

      this.engines = allEngines
        .filter(
          (engine: { enabled: boolean; categories: string[]; name: string }) =>
            engine.enabled &&
            Array.isArray(engine.categories) &&
            engine.categories.includes('general') &&
            engine.categories.includes('web')
        )
        .map((engine) => engine.name)

      if (this.engines.length === 0) {
        throw new Error('No enabled general web search engines found in SearxNG configuration')
      }

      this.isInitialized = true
      console.log(`SearxNG initialized successfully with ${this.engines.length} engines: ${this.engines.join(', ')}`)
    } catch (err) {
      this.isInitialized = false

      console.error('Failed to fetch SearxNG engine configuration:', err)
      throw new Error(`Failed to initialize SearxNG: ${err}`)
    }
  }

  public async search(query: string, maxResults: number): Promise<WebSearchResponse> {
    try {
      if (!query) {
        throw new Error('Search query cannot be empty')
      }

      // Wait for initialization if it's the first search
      if (!this.isInitialized) {
        await this.initEngines().catch(() => {}) // Ignore errors
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
        results: result.results.slice(0, maxResults).map((result) => {
          return {
            title: result.title || 'No title',
            content: result.content || '',
            url: result.url || ''
          }
        })
      }
    } catch (error) {
      console.error('Searxng search failed:', error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
