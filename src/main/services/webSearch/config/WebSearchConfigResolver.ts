import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
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

const logger = loggerService.withContext('WebSearchConfigResolver')

interface PreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

/**
 * Resolves web search runtime config from layered presets and user preference overrides.
 */
export class WebSearchConfigResolver {
  constructor(private readonly preferences: PreferenceReader = preferenceService) {}

  async getResolvedConfig(): Promise<WebSearchResolvedConfig> {
    const [providerOverrides, runtime] = await Promise.all([this.getProviderOverrides(), this.getRuntimeConfig()])

    return {
      providers: this.resolveProviders(providerOverrides),
      runtime,
      providerOverrides
    }
  }

  async getProviderById(providerId: ResolvedWebSearchProvider['id']): Promise<ResolvedWebSearchProvider | null> {
    const { providers } = await this.getResolvedConfig()
    return providers.find((provider) => provider.id === providerId) ?? null
  }

  async getRuntimeConfig(): Promise<WebSearchExecutionConfig> {
    const [
      searchWithTime,
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
      this.preferences.get('chat.web_search.search_with_time'),
      this.preferences.get('chat.web_search.max_results'),
      this.preferences.get('chat.web_search.exclude_domains'),
      this.preferences.get('chat.web_search.compression.method'),
      this.preferences.get('chat.web_search.compression.cutoff_limit'),
      this.preferences.get('chat.web_search.compression.cutoff_unit'),
      this.preferences.get('chat.web_search.compression.rag_document_count'),
      this.preferences.get('chat.web_search.compression.rag_embedding_model_id'),
      this.preferences.get('chat.web_search.compression.rag_embedding_dimensions'),
      this.preferences.get('chat.web_search.compression.rag_rerank_model_id')
    ])

    return {
      searchWithTime,
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

  private async getProviderOverrides(): Promise<WebSearchProviderOverrides> {
    const providerOverrides = await this.preferences.get('chat.web_search.provider_overrides')
    return providerOverrides || {}
  }

  private resolveProviders(providerOverrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
    return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
      const override = providerOverrides[preset.id]
      const resolved: ResolvedWebSearchProvider = {
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

      return resolved
    })
  }
}

export const webSearchConfigResolver = new WebSearchConfigResolver()

logger.debug('WebSearchConfigResolver module loaded')
