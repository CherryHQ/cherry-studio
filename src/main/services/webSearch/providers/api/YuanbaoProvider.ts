import { yuanbao } from '@cherrystudio/web-search/providers/yuanbao'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import type { ApiKeyRotationState } from '../../utils/provider'
import { RemoteWebSearchProvider } from '../base/RemoteWebSearchProvider'

export class YuanbaoProvider extends RemoteWebSearchProvider {
  constructor(provider: WebSearchProvider, state: ApiKeyRotationState) {
    super(provider, state, yuanbao)
  }

  searchKeywords(
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return this.executeRemote('searchKeywords', input, config, httpOptions)
  }
}
