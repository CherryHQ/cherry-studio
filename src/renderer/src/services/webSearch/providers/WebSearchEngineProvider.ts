import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import { filterResultWithBlacklist } from '@renderer/utils/blacklistMatchPattern'

import type BaseWebSearchProvider from './BaseWebSearchProvider'
import WebSearchProviderFactory from './WebSearchProviderFactory'

export default class WebSearchEngineProvider {
  private sdk: BaseWebSearchProvider

  constructor(provider: WebSearchProvider) {
    this.sdk = WebSearchProviderFactory.create(provider)
  }

  public async search(query: string, httpOptions?: RequestInit): Promise<WebSearchProviderResponse> {
    const result = await this.sdk.search(query, httpOptions)
    return await filterResultWithBlacklist(result)
  }
}
