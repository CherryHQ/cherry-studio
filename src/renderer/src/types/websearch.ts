import type {
  PreferenceDefaultScopeType,
  WebSearchProviderId,
  WebSearchSubscribeSource
} from '@shared/data/preference/preferenceTypes'

import type { Model, WebSearchProvider } from './index'

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit?: number
  cutoffUnit?: PreferenceDefaultScopeType['chat.web_search.compression.cutoff_unit']
  embeddingModel?: Model
  embeddingDimensions?: number
  documentCount?: number
  rerankModel?: Model
}

export type WebSearchState = {
  defaultProvider: WebSearchProviderId | null
  providers: WebSearchProvider[]
  searchWithTime: false
  maxResults: number
  excludeDomains: string[]
  subscribeSources: WebSearchSubscribeSource[]
  overwrite: false
  compressionConfig: RendererCompressionConfig
}
