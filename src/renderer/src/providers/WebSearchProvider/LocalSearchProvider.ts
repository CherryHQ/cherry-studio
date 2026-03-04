import type { WebSearchProviderResponse } from '@renderer/types'

import type { WebSearchState } from './BaseWebSearchProvider'
import BaseWebSearchProvider from './BaseWebSearchProvider'

export interface SearchItem {
  title: string
  url: string
}

/**
 * Base class for local browser-based search providers.
 * The underlying searchService API has been removed, so all searches return empty results.
 */
export default abstract class LocalSearchProvider extends BaseWebSearchProvider {
  protected abstract parseValidUrls(htmlContent: string): SearchItem[]

  public async search(_query: string, _websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    return { query: _query, results: [] }
  }
}
