/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider templates (immutable) are stored in code.
 * User configs (sparse object) are stored in Preference.
 * Runtime: template + userConfig = full provider
 *
 * Compression configuration is flattened into individual preference keys.
 */

import { usePreference } from '@data/hooks/usePreference'
import { getAllProviders, getProviderTemplate, WEB_SEARCH_PROVIDER_TEMPLATES } from '@renderer/config/webSearch'
import type {
  WebSearchCompressionCutoffUnit,
  WebSearchProvider,
  WebSearchProviderUserConfig
} from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove empty/default values from user config (sparse object pattern)
 * Only keeps fields that have non-empty values
 */
function cleanUserConfig(config: WebSearchProviderUserConfig): WebSearchProviderUserConfig {
  const cleaned: WebSearchProviderUserConfig = { id: config.id }

  if (config.apiKey && config.apiKey.trim() !== '') {
    cleaned.apiKey = config.apiKey
  }
  if (config.apiHost && config.apiHost.trim() !== '') {
    cleaned.apiHost = config.apiHost
  }
  if (config.engines && config.engines.length > 0) {
    cleaned.engines = config.engines
  }
  if (config.basicAuthUsername && config.basicAuthUsername.trim() !== '') {
    cleaned.basicAuthUsername = config.basicAuthUsername
  }
  if (config.basicAuthPassword && config.basicAuthPassword.trim() !== '') {
    cleaned.basicAuthPassword = config.basicAuthPassword
  }

  return cleaned
}

/**
 * Check if user config has any non-id fields
 */
function hasNonIdFields(config: WebSearchProviderUserConfig): boolean {
  return Object.keys(config).some((key) => key !== 'id')
}

// ============================================================================
// Provider Hooks (Template + UserConfig architecture)
// ============================================================================

/**
 * Hook for managing websearch providers
 *
 * Templates are stored in code (immutable).
 * User configs are stored in Preference (sparse object).
 * Returns merged full providers for runtime use.
 */
export function useWebSearchProviders() {
  const [userConfigs, setUserConfigs] = usePreference('chat.web_search.providers', { optimistic: false })

  // Merge templates with user configs to get full providers
  const providers = useMemo(() => getAllProviders(userConfigs), [userConfigs])

  /**
   * Update a specific provider's user config
   * Only saves non-empty fields (sparse object pattern)
   */
  const updateProvider = useCallback(
    async (providerId: string, updates: Partial<WebSearchProviderUserConfig>) => {
      // Validate provider exists in templates
      const template = getProviderTemplate(providerId)
      if (!template) {
        throw new Error(`Unknown provider ID: ${providerId}`)
      }

      const newConfigs = [...userConfigs]
      const existingIndex = newConfigs.findIndex((c) => c.id === providerId)

      if (existingIndex >= 0) {
        // Merge updates with existing config
        const merged = cleanUserConfig({
          ...newConfigs[existingIndex],
          ...updates,
          id: providerId
        })

        if (hasNonIdFields(merged)) {
          newConfigs[existingIndex] = merged
        } else {
          // Remove entry if no non-id fields remain
          newConfigs.splice(existingIndex, 1)
        }
      } else {
        // Add new config if it has non-id fields
        const cleaned = cleanUserConfig({ ...updates, id: providerId })
        if (hasNonIdFields(cleaned)) {
          newConfigs.push(cleaned)
        }
      }

      await setUserConfigs(newConfigs)
    },
    [userConfigs, setUserConfigs]
  )

  /**
   * Get a single provider by ID (merged with template)
   */
  const getProvider = useCallback(
    (providerId: string): WebSearchProvider | undefined => {
      return providers.find((p) => p.id === providerId)
    },
    [providers]
  )

  /**
   * Check if a provider is enabled (has required config)
   *
   * Enabled conditions by provider type:
   * - 'local': Always enabled (uses browser for search)
   * - 'api'/'mcp': Enabled if apiKey OR apiHost is configured
   *
   * @param providerId - The provider ID to check
   * @returns true if the provider is enabled, false otherwise
   */
  const isProviderEnabled = useCallback(
    (providerId?: string): boolean => {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) return false
      if (provider.type === 'local') return true
      if (provider.apiKey !== '') return true
      if (provider.apiHost !== '') return true
      return false
    },
    [providers]
  )

  return {
    providers,
    total: WEB_SEARCH_PROVIDER_TEMPLATES.length,
    updateProvider,
    getProvider,
    isProviderEnabled
  }
}

/**
 * Hook for a single websearch provider with update capability
 */
export function useWebSearchProvider(providerId: string) {
  const { updateProvider, getProvider } = useWebSearchProviders()

  const provider = useMemo(() => getProvider(providerId), [getProvider, providerId])

  const update = useCallback(
    async (updates: Partial<WebSearchProviderUserConfig>) => {
      await updateProvider(providerId, updates)
    },
    [updateProvider, providerId]
  )

  return {
    provider,
    updateProvider: update
  }
}

// ============================================================================
// Specialized Settings Hooks (Interface Segregation Principle)
// These hooks provide focused APIs for specific UI components,
// avoiding the need to import all settings when only a subset is needed.
// ============================================================================

/**
 * Basic websearch settings (6 items)
 */
export function useBasicWebSearchSettings() {
  const [searchWithTime, setSearchWithTime] = usePreference('chat.web_search.search_with_time')
  const [maxResults, setMaxResults] = usePreference('chat.web_search.max_results')
  const [excludeDomains, setExcludeDomains] = usePreference('chat.web_search.exclude_domains')

  return {
    searchWithTime,
    setSearchWithTime,
    maxResults,
    setMaxResults,
    excludeDomains,
    setExcludeDomains
  }
}

/**
 * Compression method selection (2 items)
 */
export function useCompressionMethod() {
  const [method, setMethod] = usePreference('chat.web_search.compression.method')
  return { method, setMethod }
}

/**
 * Cutoff compression settings (5 items)
 */
export function useCutoffCompression() {
  const [cutoffLimit, setCutoffLimit] = usePreference('chat.web_search.compression.cutoff_limit')
  const [cutoffUnit, setCutoffUnit] = usePreference('chat.web_search.compression.cutoff_unit')

  const updateCutoff = useCallback(
    async (limit: number | null, unit?: WebSearchCompressionCutoffUnit) => {
      await setCutoffLimit(limit)
      if (unit !== undefined) {
        await setCutoffUnit(unit)
      }
    },
    [setCutoffLimit, setCutoffUnit]
  )

  return {
    cutoffLimit,
    setCutoffLimit,
    cutoffUnit,
    setCutoffUnit,
    updateCutoff
  }
}

/**
 * RAG compression settings (12 items)
 */
export function useRagCompression() {
  const [ragDocumentCount, setRagDocumentCount] = usePreference('chat.web_search.compression.rag_document_count')
  const [ragEmbeddingModelId, setRagEmbeddingModelId] = usePreference(
    'chat.web_search.compression.rag_embedding_model_id'
  )
  const [ragEmbeddingProviderId, setRagEmbeddingProviderId] = usePreference(
    'chat.web_search.compression.rag_embedding_provider_id'
  )
  const [ragEmbeddingDimensions, setRagEmbeddingDimensions] = usePreference(
    'chat.web_search.compression.rag_embedding_dimensions'
  )
  const [ragRerankModelId, setRagRerankModelId] = usePreference('chat.web_search.compression.rag_rerank_model_id')
  const [ragRerankProviderId, setRagRerankProviderId] = usePreference(
    'chat.web_search.compression.rag_rerank_provider_id'
  )

  const updateRagEmbeddingModel = useCallback(
    async (modelId: string | null, providerId: string | null, dimensions?: number | null) => {
      await setRagEmbeddingModelId(modelId)
      await setRagEmbeddingProviderId(providerId)
      if (dimensions !== undefined) {
        await setRagEmbeddingDimensions(dimensions)
      }
    },
    [setRagEmbeddingModelId, setRagEmbeddingProviderId, setRagEmbeddingDimensions]
  )

  const updateRagRerankModel = useCallback(
    async (modelId: string | null, providerId: string | null) => {
      await setRagRerankModelId(modelId)
      await setRagRerankProviderId(providerId)
    },
    [setRagRerankModelId, setRagRerankProviderId]
  )

  return {
    ragDocumentCount,
    setRagDocumentCount,
    ragEmbeddingModelId,
    setRagEmbeddingModelId,
    ragEmbeddingProviderId,
    setRagEmbeddingProviderId,
    ragEmbeddingDimensions,
    setRagEmbeddingDimensions,
    ragRerankModelId,
    setRagRerankModelId,
    ragRerankProviderId,
    setRagRerankProviderId,
    updateRagEmbeddingModel,
    updateRagRerankModel
  }
}
