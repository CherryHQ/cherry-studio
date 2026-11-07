import { keenable } from '@cherrystudio/web-search/providers/keenable'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import type { ApiKeyRotationState } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

export class KeenableProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, keenable)
  }

  searchKeywords(
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return this.executeRemote('searchKeywords', input, config, httpOptions)
  }

  fetchUrls(input: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    return this.executeRemote('fetchUrls', input, config, httpOptions)
  }
}
