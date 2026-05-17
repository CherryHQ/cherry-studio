import type { PreferenceDefaultScopeType, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit: number
}

export type WebSearchState = {
  defaultProvider: WebSearchProviderId | null
  providers: ResolvedWebSearchProvider[]
  maxResults: number
  excludeDomains: string[]
  compressionConfig: RendererCompressionConfig
}
