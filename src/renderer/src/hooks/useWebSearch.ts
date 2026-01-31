/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider presets (immutable) are stored in code.
 * User overrides (sparse object) are stored in Preference.
 * Runtime: preset + override = full provider
 *
 * Compression configuration is flattened into individual preference keys.
 */

import { usePreference } from '@data/hooks/usePreference'
import { getAllProviders, getProviderTemplate } from '@renderer/config/webSearch'
import type { WebSearchCompressionCutoffUnit, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderOverride } from '@shared/data/presets/web-search-providers'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { useCallback, useMemo } from 'react'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove empty/default values from provider overrides
 */
function cleanProviderOverride(overrides: WebSearchProviderOverride): WebSearchProviderOverride {
  const cleaned: WebSearchProviderOverride = {}

  const apiKey = overrides.apiKey?.trim()
  if (apiKey) {
    cleaned.apiKey = apiKey
  }
  const apiHost = overrides.apiHost?.trim()
  if (apiHost) {
    cleaned.apiHost = apiHost
  }
  if (overrides.engines && overrides.engines.length > 0) {
    cleaned.engines = overrides.engines
  }
  const basicAuthUsername = overrides.basicAuthUsername?.trim()
  if (basicAuthUsername) {
    cleaned.basicAuthUsername = basicAuthUsername
  }
  const basicAuthPassword = overrides.basicAuthPassword?.trim()
  if (basicAuthPassword) {
    cleaned.basicAuthPassword = basicAuthPassword
  }

  return cleaned
}

/**
 * Check if override has any fields set
 */
function hasOverrideValues(overrides: WebSearchProviderOverride): boolean {
  return Object.keys(overrides).length > 0
}

// ============================================================================
// Provider Hooks (Template + UserConfig architecture)
// ============================================================================

/**
 * Hook for managing websearch providers
 *
 * Presets are stored in code (immutable).
 * User overrides are stored in Preference (sparse object).
 * Returns merged full providers for runtime use.
 */
export function useWebSearchProviders() {
  const [overrides, setOverrides] = usePreference('chat.web_search.provider_overrides', { optimistic: false })

  // Merge presets with overrides to get full providers
  const providers = useMemo(() => getAllProviders(overrides ?? {}), [overrides])

  /**
   * Update a specific provider's overrides
   * Only saves non-empty fields (sparse object pattern)
   */
  const updateProvider = useCallback(
    async (providerId: string, updates: WebSearchProviderOverride) => {
      // Validate provider exists in presets
      const template = getProviderTemplate(providerId)
      if (!template) {
        throw new Error(`Unknown provider ID: ${providerId}`)
      }

      const nextOverrides = { ...overrides }
      const merged = cleanProviderOverride({ ...nextOverrides[providerId], ...updates })

      if (hasOverrideValues(merged)) {
        nextOverrides[providerId] = merged
      } else {
        delete nextOverrides[providerId]
      }

      await setOverrides(nextOverrides)
    },
    [overrides, setOverrides]
  )

  /**
   * Get a single provider by ID (merged with preset)
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

  /**
   * Reset a provider to default preset values
   * Removes all user overrides for the specified provider
   *
   * @param providerId - The provider ID to reset
   */
  const resetProvider = useCallback(
    async (providerId: string) => {
      if (!overrides) return
      const { [providerId]: _removed, ...rest } = overrides
      void _removed // Intentionally unused, extracting rest only
      await setOverrides(rest)
    },
    [overrides, setOverrides]
  )

  /**
   * Check if a provider has been customized by the user
   *
   * @param providerId - The provider ID to check
   * @returns true if the provider has user overrides, false otherwise
   */
  const isCustomized = useCallback(
    (providerId: string): boolean => {
      if (!overrides) return false
      const override = overrides[providerId]
      return override !== undefined && hasOverrideValues(override)
    },
    [overrides]
  )

  return {
    providers,
    total: PRESETS_WEB_SEARCH_PROVIDERS.length,
    updateProvider,
    getProvider,
    isProviderEnabled,
    resetProvider,
    isCustomized
  }
}

/**
 * Hook for a single websearch provider with update capability
 */
export function useWebSearchProvider(providerId: string) {
  const { updateProvider, getProvider } = useWebSearchProviders()

  const provider = useMemo(() => getProvider(providerId), [getProvider, providerId])

  const update = useCallback(
    async (updates: WebSearchProviderOverride) => {
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
