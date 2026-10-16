import { jinaMirrorCandidates } from '@cherrystudio/web-search/providers/jina'
import { loggerService } from '@logger'
import { regionService } from '@main/services/RegionService'
import { isAbortError } from '@main/utils/error'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { executeRemoteProvider } from '../remoteWebSearchClient'

const logger = loggerService.withContext('JinaProvider')

export class JinaProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const apiHost = await this.resolveRegionAwareApiHost('searchKeywords')
    return executeRemoteProvider({
      providerId: 'jina',
      capability: 'searchKeywords',
      input: query.trim(),
      apiHost,
      credentials: { apiKey: this.resolveApiKey() },
      maxResults: config.maxResults,
      signal: httpOptions?.signal ?? undefined
    })
  }

  async fetchUrls(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const apiHost = await this.resolveRegionAwareApiHost('fetchUrls')
    const [globalHost, chinaHost] = jinaMirrorCandidates.fetchUrls
    const fallbackApiHost = apiHost === globalHost ? chinaHost : apiHost === chinaHost ? globalHost : undefined
    const request = {
      providerId: 'jina' as const,
      capability: 'fetchUrls' as const,
      input: query.trim(),
      apiHost,
      credentials: { apiKey: this.resolveApiKey(false) },
      maxResults: config.maxResults,
      signal: httpOptions?.signal ?? undefined
    }
    try {
      return await executeRemoteProvider(request)
    } catch (error) {
      if (!fallbackApiHost || request.signal?.aborted || isAbortError(error)) throw error
      logger.warn('Jina Reader preferred host failed; retrying alternate built-in host', {
        providerId: this.provider.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return executeRemoteProvider({ ...request, apiHost: fallbackApiHost })
    }
  }

  private async resolveRegionAwareApiHost(capability: WebSearchCapability): Promise<string> {
    const apiHost = resolveProviderApiHost(this.provider, capability)
    const [globalHost, chinaHost] = jinaMirrorCandidates[capability]
    if (apiHost === globalHost && (await regionService.isInChina().catch(() => false))) return chinaHost
    return apiHost
  }
}
