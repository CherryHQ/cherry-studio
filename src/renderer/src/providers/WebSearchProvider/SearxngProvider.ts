import { SearxngClient } from '@agentic/searxng'
import Logger from '@renderer/config/logger'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import { fetchWebContent, noContent } from '@renderer/utils/fetch'
import axios from 'axios'
import ky from 'ky'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class SearxngProvider extends BaseWebSearchProvider {
  private searxng: SearxngClient
  private engines: string[] = []
  private readonly basicAuthUsername?: string
  private readonly basicAuthPassword?: string
  private isInitialized = false

  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!provider.apiHost) {
      throw new Error('API host is required for SearxNG provider')
    }

    this.apiHost = provider.apiHost
    this.basicAuthUsername = provider.basicAuthUsername
    this.basicAuthPassword = provider.basicAuthPassword ? provider.basicAuthPassword : ''

    try {
      // `ky` do not support basic auth directly
      const headers = this.basicAuthUsername
        ? {
            Authorization: `Basic ` + btoa(`${this.basicAuthUsername}:${this.basicAuthPassword}`)
          }
        : undefined
      this.searxng = new SearxngClient({
        apiBaseUrl: this.apiHost,
        ky: ky.create({ headers })
      })
    } catch (error) {
      throw new Error(
        `Failed to initialize SearxNG client: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
    this.initEngines().catch((err) => console.error('Failed to initialize SearxNG engines:', err))
  }
  private async initEngines(): Promise<void> {
    try {
      Logger.log(`Initializing SearxNG with API host: ${this.apiHost}`)
      const auth = this.basicAuthUsername
        ? {
            username: this.basicAuthUsername,
            password: this.basicAuthPassword ? this.basicAuthPassword : ''
          }
        : undefined
      const response = await axios.get(`${this.apiHost}/config`, {
        timeout: 5000,
        validateStatus: (status) => status === 200, // 仅接受 200 状态码
        auth
      })

      if (!response.data) {
        throw new Error('Empty response from SearxNG config endpoint')
      }

      if (!Array.isArray(response.data.engines)) {
        throw new Error('Invalid response format: "engines" property not found or not an array')
      }

      const allEngines = response.data.engines
      Logger.log(`Found ${allEngines.length} total engines in SearxNG`)

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
      Logger.log(`SearxNG initialized successfully with ${this.engines.length} engines: ${this.engines.join(', ')}`)
    } catch (err) {
      this.isInitialized = false

      Logger.error('Failed to fetch SearxNG engine configuration:', err)
      throw new Error(`Failed to initialize SearxNG: ${err}`)
    }
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
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

      const validItems = result.results
        .filter((item) => item.url.startsWith('http') || item.url.startsWith('https'))
        .slice(0, websearch.maxResults)
      // Logger.log('Valid search items:', validItems)

      // Fetch content for each URL concurrently
      const fetchPromises = validItems.map(async (item) => {
        // Logger.log(`Fetching content for ${item.url}...`)
        return await fetchWebContent(item.url, 'markdown', this.provider.usingBrowser)
      })

      // Wait for all fetches to complete
      const results = await Promise.all(fetchPromises)

      return {
        query: query,
        results: results.filter((result) => result.content != noContent)
      }
    } catch (error) {
      Logger.error('Searxng search failed:', error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
