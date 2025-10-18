import { WebSearchState } from '@renderer/store/websearch'
import { ProviderSpecificParams, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class DefaultProvider extends BaseWebSearchProvider {
  search(
    _query: string,
    _websearch: WebSearchState,
    _httpOptions?: RequestInit,
    _providerParams?: ProviderSpecificParams
  ): Promise<WebSearchProviderResponse> {
    throw new Error('Method not implemented.')
  }
}
