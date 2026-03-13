import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import type { CherryWebSearchConfig, CompressionConfig } from '@renderer/store/websearch'
import type { Model, Provider } from '@renderer/types'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

export const WEB_SEARCH_SETTINGS_KEYS = {
  compressionMethod: 'chat.web_search.compression.method',
  cutoffLimit: 'chat.web_search.compression.cutoff_limit',
  cutoffUnit: 'chat.web_search.compression.cutoff_unit',
  ragDocumentCount: 'chat.web_search.compression.rag_document_count',
  ragEmbeddingDimensions: 'chat.web_search.compression.rag_embedding_dimensions',
  ragEmbeddingModelId: 'chat.web_search.compression.rag_embedding_model_id',
  ragRerankModelId: 'chat.web_search.compression.rag_rerank_model_id',
  excludeDomains: 'chat.web_search.exclude_domains',
  maxResults: 'chat.web_search.max_results',
  searchWithTime: 'chat.web_search.search_with_time'
} as const satisfies Record<string, PreferenceKeyType>

export const WEB_SEARCH_SETTINGS_PREFERENCE_KEYS = Object.values(WEB_SEARCH_SETTINGS_KEYS) as PreferenceKeyType[]

type WebSearchSettingsKey = keyof typeof WEB_SEARCH_SETTINGS_KEYS

export type WebSearchSettingsPreferenceValues = {
  [K in WebSearchSettingsKey]: PreferenceDefaultScopeType[(typeof WEB_SEARCH_SETTINGS_KEYS)[K]]
}

const WEB_SEARCH_SETTINGS_ENTRIES = Object.entries(WEB_SEARCH_SETTINGS_KEYS) as [
  WebSearchSettingsKey,
  (typeof WEB_SEARCH_SETTINGS_KEYS)[WebSearchSettingsKey]
][]

const buildCompressionModelPreferenceId = (model?: Pick<Model, 'id' | 'provider'> | null): string | null => {
  const providerId = model?.provider?.trim()
  const modelId = model?.id?.trim()

  if (!providerId || !modelId) {
    return null
  }

  return `${providerId}::${modelId}`
}

const resolveCompressionModel = (modelId: string | null, providers: Provider[]): Model | undefined => {
  if (!modelId) {
    return undefined
  }

  const separatorIndex = modelId.indexOf('::')

  if (separatorIndex === -1) {
    return undefined
  }

  const providerId = modelId.slice(0, separatorIndex)
  const actualModelId = modelId.slice(separatorIndex + 2)

  return providers.find((provider) => provider.id === providerId)?.models?.find((model) => model.id === actualModelId)
}

const buildDefaultWebSearchSettings = (): WebSearchSettingsPreferenceValues => {
  const defaults = {} as Record<WebSearchSettingsKey, WebSearchSettingsPreferenceValues[WebSearchSettingsKey]>

  for (const [localKey, preferenceKey] of WEB_SEARCH_SETTINGS_ENTRIES) {
    defaults[localKey] = DefaultPreferences.default[preferenceKey] as WebSearchSettingsPreferenceValues[typeof localKey]
  }

  return defaults as WebSearchSettingsPreferenceValues
}

export const DEFAULT_WEB_SEARCH_SETTINGS = buildDefaultWebSearchSettings()

export const readWebSearchSettings = (
  readPreference: (
    key: (typeof WEB_SEARCH_SETTINGS_KEYS)[WebSearchSettingsKey]
  ) => PreferenceDefaultScopeType[(typeof WEB_SEARCH_SETTINGS_KEYS)[WebSearchSettingsKey]] | undefined
): WebSearchSettingsPreferenceValues => {
  const values = {} as Record<WebSearchSettingsKey, WebSearchSettingsPreferenceValues[WebSearchSettingsKey]>

  for (const [localKey, preferenceKey] of WEB_SEARCH_SETTINGS_ENTRIES) {
    const value = readPreference(preferenceKey)
    values[localKey] = (
      value !== undefined ? value : DEFAULT_WEB_SEARCH_SETTINGS[localKey]
    ) as WebSearchSettingsPreferenceValues[typeof localKey]
  }

  return values as WebSearchSettingsPreferenceValues
}

export const resolveWebSearchCompressionConfig = (
  preferences: WebSearchSettingsPreferenceValues,
  providers: Provider[]
): CompressionConfig => ({
  method: preferences.compressionMethod,
  cutoffLimit: preferences.cutoffLimit ?? undefined,
  cutoffUnit: preferences.cutoffUnit,
  documentCount: preferences.ragDocumentCount,
  embeddingDimensions: preferences.ragEmbeddingDimensions ?? undefined,
  embeddingModel: resolveCompressionModel(preferences.ragEmbeddingModelId, providers),
  rerankModel: resolveCompressionModel(preferences.ragRerankModelId, providers)
})

export const resolveWebSearchConfig = (preferences: WebSearchSettingsPreferenceValues): CherryWebSearchConfig => ({
  maxResults: preferences.maxResults,
  excludeDomains: preferences.excludeDomains,
  searchWithTime: preferences.searchWithTime
})

export const buildCompressionPreferenceUpdates = (config: Partial<CompressionConfig>) => ({
  compressionMethod: config.method ?? DEFAULT_WEB_SEARCH_SETTINGS.compressionMethod,
  cutoffLimit: config.cutoffLimit ?? null,
  cutoffUnit: config.cutoffUnit ?? DEFAULT_WEB_SEARCH_SETTINGS.cutoffUnit,
  ragDocumentCount: config.documentCount ?? DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT,
  ragEmbeddingDimensions: config.embeddingDimensions ?? null,
  ragEmbeddingModelId: buildCompressionModelPreferenceId(config.embeddingModel),
  ragRerankModelId: buildCompressionModelPreferenceId(config.rerankModel)
})
