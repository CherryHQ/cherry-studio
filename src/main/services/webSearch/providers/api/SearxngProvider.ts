import { discoverSearxngEngines, searxng } from '@cherrystudio/web-search/providers/searxng'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { electronWebSearchTransport } from '../../transport'
import { fetchSearchResultContents } from '../../utils/fetchContent'
import type { ApiKeyRotationState } from '../../utils/provider'
import { resolveProviderApiHost } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

export class SearxngProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, searxng)
  }

  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const signal = httpOptions?.signal ?? undefined
    const credentials = this.credentials()
    let engines = this.provider.engines.map((engine) => engine.trim()).filter(Boolean)
    if (!engines.length) {
      engines = await discoverSearxngEngines({
        config: { apiHost: resolveProviderApiHost(this.provider, 'searchKeywords') },
        credentials,
        transport: electronWebSearchTransport,
        signal
      })
    }
    const response = await this.executeRemote('searchKeywords', query, config, httpOptions, { credentials, engines })
    const results = await fetchSearchResultContents(
      response.results.map((item) => item.url),
      {
        query,
        providerLabel: 'Searxng',
        signal,
        getFallbackResult: (_url, index) => {
          const item = response.results[index]
          return item.content.trim() ? { ...item, title: item.title || item.url } : undefined
        }
      }
    )
    return { ...response, results: results.map((result) => ({ ...result, sourceInput: query })) }
  }
}
