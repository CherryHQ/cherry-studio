import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

export default abstract class BaseWebSearchProvider {
  // @ts-ignore this
  private provider: WebSearchProvider
  protected apiKey: string
  protected apiHost: string | undefined // 添加受保护的 apiHost 字段

  constructor(provider: WebSearchProvider) {
    this.provider = provider
    this.apiKey = this.getApiKey()
    this.apiHost = provider.apiHost // 在构造函数中初始化 apiHost
  }

  abstract search(query: string, maxResult: number, excludeDomains: string[]): Promise<WebSearchResponse>

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
