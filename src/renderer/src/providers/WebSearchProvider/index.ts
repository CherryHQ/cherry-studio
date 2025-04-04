import { WebSearchProvider, WebSearchResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import WebSearchProviderFactory from './WebSearchProviderFactory'

export default class WebSearchEngineProvider {
  private sdk: BaseWebSearchProvider
  constructor(provider: WebSearchProvider) {
    this.sdk = WebSearchProviderFactory.create(provider)
  }
  public async search(query: string, maxResult: number, excludeDomains: string[]): Promise<WebSearchResponse> {
    return await this.sdk.search(query, maxResult, excludeDomains)
  }
}
