import type { PreferenceDefaultScopeType, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'

import type { WebSearchProvider } from './index'

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit: number
}

export type WebSearchState = {
  defaultProvider: WebSearchProviderId | null
  providers: WebSearchProvider[]
  maxResults: number
  excludeDomains: string[]
  compressionConfig: RendererCompressionConfig
}
