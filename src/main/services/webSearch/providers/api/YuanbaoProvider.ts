import { isWebSearchError } from '@cherrystudio/web-search'
import { yuanbao } from '@cherrystudio/web-search/providers/yuanbao'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { toExcludedSiteDomains } from '../../utils/blacklist'
import type { ApiKeyRotationState } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

export class YuanbaoProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, yuanbao)
  }

  async searchKeywords(
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const requestConfig = {
      ...config,
      excludeDomains: toExcludedSiteDomains(config.excludeDomains)
    }
    const credentials = this.credentials()
    try {
      return await this.executeRemote('searchKeywords', input, requestConfig, httpOptions, { credentials })
    } catch (error) {
      if (
        !isWebSearchError(error) ||
        error.kind !== 'provider' ||
        error.providerCode !== 'InvalidParameter' ||
        !/(?:\bCnt\b\s+(?:is\s+)?(?:not\s+supported|unsupported)\b|\b(?:does\s+not\s+support|unsupported)\s+(?:parameter\s+)?Cnt\b|不支持(?:参数)?\s*Cnt\b|\bCnt\b(?:参数)?\s*不支持)/i.test(
          error.message
        )
      )
        throw error
      return this.executeRemote('searchKeywords', input, requestConfig, httpOptions, {
        credentials,
        useDefaultResultCount: true
      })
    }
  }
}
