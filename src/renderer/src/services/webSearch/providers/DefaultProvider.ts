import type { WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class DefaultProvider extends BaseWebSearchProvider {
  search(): Promise<WebSearchProviderResponse> {
    throw new Error(
      `Search not implemented for provider "${this.provider.id}". Please select a supported search provider.`
    )
  }
}
