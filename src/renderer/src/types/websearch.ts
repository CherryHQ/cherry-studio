import type {
  PreferenceDefaultScopeType,
  WebSearchProviderId,
  WebSearchSubscribeSource
} from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit: number
  cutoffUnit?: PreferenceDefaultScopeType['chat.web_search.compression.cutoff_unit']
}

export type WebSearchState = {
  defaultProvider: WebSearchProviderId | null
  providers: ResolvedWebSearchProvider[]
  searchWithTime: boolean
  maxResults: number
  excludeDomains: string[]
  subscribeSources: WebSearchSubscribeSource[]
  compressionConfig: RendererCompressionConfig
}
