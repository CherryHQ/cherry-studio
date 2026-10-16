import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { executeRemoteProvider } from '../remoteWebSearchClient'

export class Crawl4AIProvider extends BaseWebSearchProvider {
  async fetchUrls(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return executeRemoteProvider({
      providerId: 'crawl4ai',
      capability: 'fetchUrls',
      input: query.trim(),
      apiHost: resolveProviderApiHost(this.provider, 'fetchUrls'),
      credentials: { apiKey: this.resolveApiKey(false) },
      maxResults: config.maxResults,
      excludeDomains: config.excludeDomains,
      signal: httpOptions?.signal ?? undefined
    })
  }
}
