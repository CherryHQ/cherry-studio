import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

export default abstract class BaseWebSearchProvider {
  // @ts-ignore this
  private provider: WebSearchProvider
  constructor(provider: WebSearchProvider) {
    this.provider = provider
  }
  abstract search(query: string, maxResult: number, excludeDomains: string[]): Promise<WebSearchResponse>
}
