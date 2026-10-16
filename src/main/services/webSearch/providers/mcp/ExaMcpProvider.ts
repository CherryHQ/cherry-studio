import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { executeRemoteProvider } from '../remoteWebSearchClient'

export class ExaMcpProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return executeRemoteProvider({
      providerId: 'exa-mcp',
      capability: 'searchKeywords',
      input: query,
      apiHost: resolveProviderApiHost(this.provider, 'searchKeywords'),
      credentials: { apiKey: this.resolveApiKey(false) },
      maxResults: config.maxResults,
      excludeDomains: config.excludeDomains,
      signal: httpOptions?.signal ?? undefined,
      timeoutMs: 25_000
    })
  }
}
