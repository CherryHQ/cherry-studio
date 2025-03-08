import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchResponse } from '@renderer/types'
import { filterResultWithBlacklist } from '@renderer/utils/blacklistMatchPattern'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import WebSearchProviderFactory from './WebSearchProviderFactory'

export default class WebSearchEngineProvider {
  private sdk: BaseWebSearchProvider
  constructor(provider: WebSearchProvider) {
    this.sdk = WebSearchProviderFactory.create(provider)
  }
  public async search(query: string, websearch: WebSearchState): Promise<WebSearchResponse> {
    const result = await this.sdk.search(query, websearch)
    const filteredResult = await filterResultWithBlacklist(result, websearch)
    console.log('filteredResult', websearch, filteredResult)

    return filteredResult
  }
}
