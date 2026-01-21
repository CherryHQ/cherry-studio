import { cacheService } from '@data/CacheService'
import { preferenceService } from '@data/PreferenceService'
import type { WebSearchConfig, WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

export default abstract class BaseWebSearchProvider {
  protected readonly provider: WebSearchProvider
  protected apiHost?: string
  protected apiKey: string

  constructor(provider: WebSearchProvider) {
    this.provider = provider
    this.apiHost = this.getApiHost()
    this.apiKey = this.getApiKey()
  }

  abstract search(query: string, httpOptions?: RequestInit): Promise<WebSearchProviderResponse>

  protected async getSearchConfig(): Promise<WebSearchConfig> {
    const [maxResults, excludeDomains, searchWithTime] = await Promise.all([
      preferenceService.get('chat.websearch.max_results'),
      preferenceService.get('chat.websearch.exclude_domains'),
      preferenceService.get('chat.websearch.search_with_time')
    ])
    return { maxResults, excludeDomains, searchWithTime }
  }

  public getApiHost() {
    return this.provider.apiHost
  }

  public defaultHeaders() {
    return {
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio'
    }
  }

  public getApiKey() {
    const keys = this.provider.apiKey?.split(',').map((key) => key.trim()) || []
    const keyName = `web-search-provider:${this.provider.id}:last_used_key`

    if (keys.length === 1) {
      return keys[0]
    }

    const lastUsedKey = cacheService.getSharedCasual<string>(keyName)
    if (lastUsedKey === undefined) {
      cacheService.setSharedCasual(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    cacheService.setSharedCasual(keyName, nextKey)

    return nextKey
  }
}
