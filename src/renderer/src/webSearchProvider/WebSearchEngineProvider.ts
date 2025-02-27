import { WebSearchProvider } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import WebSearchProviderFactory from './WebSearchProviderFactory'

export default class WebSearchEngineProvider {
  private sdk: BaseWebSearchProvider
  constructor(provider: WebSearchProvider) {
    this.sdk = WebSearchProviderFactory.create(provider)
  }
  public async search(query: string, maxResult: number, excludeDomains: string[]): Promise<string> {
    return await this.sdk.search(query, maxResult, excludeDomains)
  }
}
