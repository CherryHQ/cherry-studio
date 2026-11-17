import { getJinaHostCandidates, jina, JINA_MIRROR_HOSTS } from '@cherrystudio/web-search/providers/jina'
import { loggerService } from '@logger'
import { regionService } from '@main/services/RegionService'
import { isAbortError } from '@main/utils/error'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import type { ApiKeyRotationState } from '../../utils/provider'
import { resolveProviderApiHost } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

const logger = loggerService.withContext('JinaProvider')
const GLOBAL_READER_HOST = 'https://r.jina.ai'

export class JinaProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, jina)
  }

  private async preferredHost(capability: WebSearchCapability): Promise<string> {
    const configured = resolveProviderApiHost(this.provider, capability)
    const inChina = JINA_MIRROR_HOSTS[configured] && (await regionService.isInChina().catch(() => false))
    return getJinaHostCandidates(configured, inChina ? 'mainland-china' : 'global')[0]
  }

  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return this.executeRemote('searchKeywords', query.trim(), config, httpOptions, {
      apiHost: await this.preferredHost('searchKeywords')
    })
  }

  async fetchUrls(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const apiHost = await this.preferredHost('fetchUrls')
    const credentials = this.credentials()
    const mirror = JINA_MIRROR_HOSTS[GLOBAL_READER_HOST]
    const alternate = apiHost === GLOBAL_READER_HOST ? mirror : apiHost === mirror ? GLOBAL_READER_HOST : undefined
    try {
      return await this.executeRemote('fetchUrls', query, config, httpOptions, { apiHost, credentials })
    } catch (error) {
      if (!alternate || httpOptions?.signal?.aborted || isAbortError(error)) throw error
      logger.warn('Jina Reader preferred host failed; retrying alternate built-in host', {
        providerId: this.provider.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return this.executeRemote('fetchUrls', query, config, httpOptions, { apiHost: alternate, credentials })
    }
  }
}
