import type {
  PreferenceDefaultScopeType,
  WebSearchProvider,
  WebSearchProviderId
} from '@shared/data/preference/preferenceTypes'

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
