import { WebSearchState } from '@renderer/store/websearch'
import { ProviderSpecificParams, WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

export default abstract class BaseWebSearchProvider {
  // @ts-ignore this
  protected provider: WebSearchProvider
  protected apiHost?: string
  protected apiKey: string

  constructor(provider: WebSearchProvider) {
    this.provider = provider
    this.apiHost = this.getApiHost()
    this.apiKey = this.getApiKey()
  }

  abstract search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit,
    providerParams?: ProviderSpecificParams
  ): Promise<WebSearchProviderResponse>

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

    const lastUsedKey = window.keyv.get(keyName)
    if (!lastUsedKey) {
      window.keyv.set(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    window.keyv.set(keyName, nextKey)

    return nextKey
  }
}
