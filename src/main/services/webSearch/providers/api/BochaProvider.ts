import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { executeRemoteProvider } from '../remoteWebSearchClient'

export class BochaProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return executeRemoteProvider({
      providerId: 'bocha',
      capability: 'searchKeywords',
      input: query,
      apiHost: resolveProviderApiHost(this.provider, 'searchKeywords'),
      credentials: { apiKey: this.resolveApiKey(true) },
      maxResults: config.maxResults,
      excludeDomains: config.excludeDomains,
      signal: httpOptions?.signal ?? undefined
    })
  }
}
