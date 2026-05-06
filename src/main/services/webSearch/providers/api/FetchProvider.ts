import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { fetchWebSearchContent } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

export class FetchProvider extends BaseWebSearchProvider {
  async search(
    query: string,
    _config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const url = query.trim()
    const result = await fetchWebSearchContent(url, { signal: httpOptions?.signal })

    return {
      query: url,
      results: [result]
    }
  }
}
