import { bocha } from '@cherrystudio/web-search/providers/bocha'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { toExcludedSiteDomains } from '../../utils/blacklist'
import type { ApiKeyRotationState } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

export class BochaProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, bocha)
  }

  searchKeywords(
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return this.executeRemote(
      'searchKeywords',
      input,
      { ...config, excludeDomains: toExcludedSiteDomains(config.excludeDomains) },
      httpOptions
    )
  }
}
