import type {
  PreferenceDefaultScopeType,
  WebSearchProviderId,
  WebSearchSubscribeSource
} from '@shared/data/preference/preferenceTypes'

import type { WebSearchProvider } from './index'

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit: number
  cutoffUnit?: PreferenceDefaultScopeType['chat.web_search.compression.cutoff_unit']
}

export type WebSearchState = {
  defaultProvider: WebSearchProviderId | null
  providers: WebSearchProvider[]
  maxResults: number
  excludeDomains: string[]
  subscribeSources: WebSearchSubscribeSource[]
  compressionConfig: RendererCompressionConfig
}
