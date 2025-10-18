import { withSpanResult } from '@renderer/services/SpanManagerService'
import type { WebSearchState } from '@renderer/store/websearch'
import { ProviderSpecificParams, WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import { filterResultWithBlacklist } from '@renderer/utils/blacklistMatchPattern'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import WebSearchProviderFactory from './WebSearchProviderFactory'

export default class WebSearchEngineProvider {
  private sdk: BaseWebSearchProvider
  private providerName: string
  private topicId: string | undefined
  private parentSpanId: string | undefined
  private modelName: string | undefined

  constructor(provider: WebSearchProvider, parentSpanId?: string) {
    this.sdk = WebSearchProviderFactory.create(provider)
    this.providerName = provider.name
    this.topicId = provider.topicId
    this.parentSpanId = parentSpanId
    this.modelName = provider.modelName
  }

  public async search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit,
    providerParams?: ProviderSpecificParams
  ): Promise<WebSearchProviderResponse> {
    const callSearch = async ({ query, websearch, providerParams }) => {
      return await this.sdk.search(query, websearch, httpOptions, providerParams)
    }

    const traceParams = {
      name: `${this.providerName}.search`,
      tag: 'Web',
      topicId: this.topicId || '',
      parentSpanId: this.parentSpanId,
      modelName: this.modelName
    }

    const result = await withSpanResult(callSearch, traceParams, { query, websearch, providerParams })

    return await filterResultWithBlacklist(result, websearch)
  }
}
