import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

export default abstract class BaseWebSearchProvider {
  // 将 private 修改为 protected
  protected provider: WebSearchProvider
  constructor(provider: WebSearchProvider) {
    this.provider = provider
  }
  abstract search(query: string, maxResult: number, excludeDomains: string[]): Promise<WebSearchResponse>
}
