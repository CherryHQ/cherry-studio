import { preferenceService } from '@data/PreferenceService'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchProviderOverrides,
  WebSearchProviderType
} from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResolvedConfig
} from '@shared/data/types/webSearch'

export interface WebSearchPreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

export async function getProviderOverrides(
  preferences: WebSearchPreferenceReader = preferenceService
): Promise<WebSearchProviderOverrides> {
  const providerOverrides = await preferences.get('chat.web_search.provider_overrides')
  return providerOverrides || {}
}

export function resolveProviders(providerOverrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = providerOverrides[preset.id]

    return {
      id: preset.id,
      name: preset.name,
      type: preset.type as WebSearchProviderType,
      usingBrowser: preset.usingBrowser,
      apiKey: override?.apiKey?.trim() || '',
      apiHost: override?.apiHost?.trim() || preset.defaultApiHost,
      engines: override?.engines || [],
      basicAuthUsername: override?.basicAuthUsername?.trim() || '',
      basicAuthPassword: override?.basicAuthPassword?.trim() || ''
    }
  })
}

export async function getRuntimeConfig(
  preferences: WebSearchPreferenceReader = preferenceService
): Promise<WebSearchExecutionConfig> {
  const [
    maxResults,
    excludeDomains,
    method,
    cutoffLimit,
    cutoffUnit,
    ragDocumentCount,
    ragEmbeddingModelId,
    ragEmbeddingDimensions,
    ragRerankModelId
  ] = await Promise.all([
    preferences.get('chat.web_search.max_results'),
    preferences.get('chat.web_search.exclude_domains'),
    preferences.get('chat.web_search.compression.method'),
    preferences.get('chat.web_search.compression.cutoff_limit'),
    preferences.get('chat.web_search.compression.cutoff_unit'),
    preferences.get('chat.web_search.compression.rag_document_count'),
    preferences.get('chat.web_search.compression.rag_embedding_model_id'),
    preferences.get('chat.web_search.compression.rag_embedding_dimensions'),
    preferences.get('chat.web_search.compression.rag_rerank_model_id')
  ])

  return {
    maxResults,
    excludeDomains,
    compression: {
      method,
      cutoffLimit,
      cutoffUnit,
      ragDocumentCount,
      ragEmbeddingModelId,
      ragEmbeddingDimensions,
      ragRerankModelId
    }
  }
}

export async function getResolvedConfig(
  preferences: WebSearchPreferenceReader = preferenceService
): Promise<WebSearchResolvedConfig> {
  const [providerOverrides, runtime] = await Promise.all([
    getProviderOverrides(preferences),
    getRuntimeConfig(preferences)
  ])

  return {
    providers: resolveProviders(providerOverrides),
    runtime,
    providerOverrides
  }
}

export async function getProviderById(
  providerId: ResolvedWebSearchProvider['id'],
  preferences: WebSearchPreferenceReader = preferenceService
): Promise<ResolvedWebSearchProvider | null> {
  const { providers } = await getResolvedConfig(preferences)
  return providers.find((provider) => provider.id === providerId) ?? null
}
