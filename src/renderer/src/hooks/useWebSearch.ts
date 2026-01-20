/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider configuration is stored directly in Preference system.
 * No merge logic needed - providers are read directly from Preference.
 *
 * Compression configuration is now flattened into individual preference keys.
 */

import { usePreference } from '@data/hooks/usePreference'
import type {
  WebSearchCompressionCutoffUnit,
  WebSearchCompressionMethod,
  WebSearchProvider
} from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'

// ============================================================================
// Provider Hooks (Preference-based)
// ============================================================================

/**
 * Hook for managing websearch providers
 *
 * Providers are stored directly in Preference, no merge needed.
 */
export function useWebSearchProviders() {
  const [providers, setProviders] = usePreference('chat.websearch.providers')

  /**
   * Update a specific provider by ID
   */
  const updateProvider = useCallback(
    async (providerId: string, updates: Partial<WebSearchProvider>) => {
      const index = providers.findIndex((p) => p.id === providerId)
      if (index === -1) {
        throw new Error(`Unknown provider ID: ${providerId}`)
      }

      const newProviders = [...providers]
      newProviders[index] = { ...newProviders[index], ...updates }
      await setProviders(newProviders)
    },
    [providers, setProviders]
  )

  /**
   * Get a single provider by ID
   */
  const getProvider = useCallback(
    (providerId: string): WebSearchProvider | undefined => {
      return providers.find((p) => p.id === providerId)
    },
    [providers]
  )

  /**
   * Check if a provider is enabled (has required config)
   */
  const isProviderEnabled = useCallback(
    (providerId?: string): boolean => {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) return false
      if (provider.id.startsWith('local-')) return true
      if (provider.apiKey !== '') return true
      if (provider.apiHost !== '') return true
      return false
    },
    [providers]
  )

  return {
    providers,
    total: providers.length,
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
    async (updates: Partial<WebSearchProvider>) => {
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
// Compression Hooks (v2 - Flattened)
// ============================================================================

/**
 * Hook for websearch compression settings (flattened preference keys)
 */
export function useWebSearchCompression() {
  // Method
  const [method, setMethod] = usePreference('chat.websearch.compression.method')

  // Cutoff settings
  const [cutoffLimit, setCutoffLimit] = usePreference('chat.websearch.compression.cutoff_limit')
  const [cutoffUnit, setCutoffUnit] = usePreference('chat.websearch.compression.cutoff_unit')

  // RAG settings
  const [ragDocumentCount, setRagDocumentCount] = usePreference('chat.websearch.compression.rag_document_count')
  const [ragEmbeddingModelId, setRagEmbeddingModelId] = usePreference(
    'chat.websearch.compression.rag_embedding_model_id'
  )
  const [ragEmbeddingProviderId, setRagEmbeddingProviderId] = usePreference(
    'chat.websearch.compression.rag_embedding_provider_id'
  )
  const [ragEmbeddingDimensions, setRagEmbeddingDimensions] = usePreference(
    'chat.websearch.compression.rag_embedding_dimensions'
  )
  const [ragRerankModelId, setRagRerankModelId] = usePreference('chat.websearch.compression.rag_rerank_model_id')
  const [ragRerankProviderId, setRagRerankProviderId] = usePreference(
    'chat.websearch.compression.rag_rerank_provider_id'
  )

  /**
   * Update compression method
   */
  const updateMethod = useCallback(
    async (newMethod: WebSearchCompressionMethod) => {
      await setMethod(newMethod)
    },
    [setMethod]
  )

  /**
   * Update cutoff settings
   */
  const updateCutoff = useCallback(
    async (limit: number | null, unit?: WebSearchCompressionCutoffUnit) => {
      await setCutoffLimit(limit)
      if (unit !== undefined) {
        await setCutoffUnit(unit)
      }
    },
    [setCutoffLimit, setCutoffUnit]
  )

  /**
   * Update RAG embedding model
   */
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

  /**
   * Update RAG rerank model
   */
  const updateRagRerankModel = useCallback(
    async (modelId: string | null, providerId: string | null) => {
      await setRagRerankModelId(modelId)
      await setRagRerankProviderId(providerId)
    },
    [setRagRerankModelId, setRagRerankProviderId]
  )

  return {
    // Values
    method,
    cutoffLimit,
    cutoffUnit,
    ragDocumentCount,
    ragEmbeddingModelId,
    ragEmbeddingProviderId,
    ragEmbeddingDimensions,
    ragRerankModelId,
    ragRerankProviderId,
    // Individual setters
    setMethod,
    setCutoffLimit,
    setCutoffUnit,
    setRagDocumentCount,
    setRagEmbeddingModelId,
    setRagEmbeddingProviderId,
    setRagEmbeddingDimensions,
    setRagRerankModelId,
    setRagRerankProviderId,
    // Convenience update functions
    updateMethod,
    updateCutoff,
    updateRagEmbeddingModel,
    updateRagRerankModel
  }
}

// ============================================================================
// Settings Hooks (Preference)
// ============================================================================

/**
 * Hook for websearch settings (all preference-based settings)
 */
export function useWebSearchSettings() {
  const [searchWithTime, setSearchWithTime] = usePreference('chat.websearch.search_with_time')
  const [maxResults, setMaxResults] = usePreference('chat.websearch.max_results')
  const [excludeDomains, setExcludeDomains] = usePreference('chat.websearch.exclude_domains')

  // Use the compression hook
  const {
    method: compressionMethod,
    setMethod: setCompressionMethod,
    cutoffLimit,
    setCutoffLimit,
    cutoffUnit,
    setCutoffUnit,
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
    updateMethod,
    updateCutoff,
    updateRagEmbeddingModel,
    updateRagRerankModel
  } = useWebSearchCompression()

  return {
    // Basic settings
    searchWithTime,
    maxResults,
    excludeDomains,
    // Setters for basic settings
    setSearchWithTime,
    setMaxResults,
    setExcludeDomains,
    // Compression individual values
    compressionMethod,
    cutoffLimit,
    cutoffUnit,
    ragDocumentCount,
    ragEmbeddingModelId,
    ragEmbeddingProviderId,
    ragEmbeddingDimensions,
    ragRerankModelId,
    ragRerankProviderId,
    // Compression setters
    setCompressionMethod,
    setCutoffLimit,
    setCutoffUnit,
    setRagDocumentCount,
    setRagEmbeddingModelId,
    setRagEmbeddingProviderId,
    setRagEmbeddingDimensions,
    setRagRerankModelId,
    setRagRerankProviderId,
    // Convenience update functions
    updateMethod,
    updateCutoff,
    updateRagEmbeddingModel,
    updateRagRerankModel
  }
}
