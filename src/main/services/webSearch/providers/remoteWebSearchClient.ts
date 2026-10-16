import {
  createWebSearchClient,
  WebSearchError,
  type WebSearchCapability,
  type WebSearchCredentials,
  type WebSearchProviderId
} from '@cherrystudio/web-search'
import { bocha } from '@cherrystudio/web-search/providers/bocha'
import { crawl4ai } from '@cherrystudio/web-search/providers/crawl4ai'
import { exa } from '@cherrystudio/web-search/providers/exa'
import { exaMcp } from '@cherrystudio/web-search/providers/exa-mcp'
import { firecrawl } from '@cherrystudio/web-search/providers/firecrawl'
import { jina } from '@cherrystudio/web-search/providers/jina'
import { parallel } from '@cherrystudio/web-search/providers/parallel'
import { querit } from '@cherrystudio/web-search/providers/querit'
import { searxng } from '@cherrystudio/web-search/providers/searxng'
import { serply } from '@cherrystudio/web-search/providers/serply'
import { tavily } from '@cherrystudio/web-search/providers/tavily'
import { zhipu } from '@cherrystudio/web-search/providers/zhipu'
import type { WebSearchResponse } from '@shared/data/types/webSearch'

import { electronWebSearchTransport } from '../http/electronWebSearchTransport'
import { WebSearchConfigError, type WebSearchConfigErrorCode } from '../WebSearchConfigError'

const client = createWebSearchClient({
  transport: electronWebSearchTransport,
  providers: [
    { provider: zhipu, capabilities: ['searchKeywords'] },
    { provider: tavily, capabilities: ['searchKeywords'] },
    { provider: searxng, capabilities: ['searchKeywords'] },
    { provider: exa, capabilities: ['searchKeywords'] },
    { provider: exaMcp, capabilities: ['searchKeywords'] },
    { provider: bocha, capabilities: ['searchKeywords'] },
    { provider: querit, capabilities: ['searchKeywords', 'fetchUrls'] },
    { provider: jina, capabilities: ['searchKeywords', 'fetchUrls'] },
    { provider: firecrawl, capabilities: ['searchKeywords', 'fetchUrls'] },
    { provider: crawl4ai, capabilities: ['fetchUrls'] },
    { provider: parallel, capabilities: ['searchKeywords'] },
    { provider: serply, capabilities: ['searchKeywords'] }
  ]
})

const permanentCodes: readonly WebSearchConfigErrorCode[] = [
  'provider_not_configured',
  'provider_unknown',
  'capability_unsupported',
  'api_key_missing',
  'api_host_missing',
  'api_host_invalid'
]

export async function executeRemoteProvider(request: {
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  input: string
  apiHost: string
  credentials?: WebSearchCredentials
  maxResults: number
  excludeDomains?: readonly string[]
  engines?: readonly string[]
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<WebSearchResponse> {
  const { apiHost, maxResults, excludeDomains, engines, ...operation } = request
  try {
    const config = { apiHost, excludeDomains, engines }
    const response = await client.execute(
      operation.capability === 'searchKeywords'
        ? { ...operation, capability: 'searchKeywords', config: { ...config, maxResults } }
        : { ...operation, capability: 'fetchUrls', config }
    )
    return {
      query: request.input,
      providerId: request.providerId,
      capability: request.capability,
      inputs: [request.input],
      results: response.results.map(({ title, url, content, sourceInput }) => ({ title, url, content, sourceInput }))
    }
  } catch (error) {
    if (error instanceof WebSearchError) {
      if (error.kind === 'configuration' && permanentCodes.includes(error.code as WebSearchConfigErrorCode)) {
        throw new WebSearchConfigError(error.code as WebSearchConfigErrorCode, error.message)
      }
      if (error.kind === 'cancelled') {
        request.signal?.throwIfAborted()
        throw new DOMException('Web search cancelled', 'AbortError')
      }
      if (error.kind === 'timeout') throw new DOMException('Web search timed out', 'TimeoutError')
    }
    throw error
  }
}
