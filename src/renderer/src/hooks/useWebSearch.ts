/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider configuration is stored directly in Preference system.
 * No merge logic needed - providers are read directly from Preference.
 *
 * Compression configuration is now flattened into individual preference keys.
 */

import { usePreference } from '@data/hooks/usePreference'
import type { WebSearchCompressionCutoffUnit, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
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
      if (provider.type === 'local') return true
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
// Specialized Settings Hooks (Phase 4 - ISP Compliance)
// ============================================================================

/**
 * Basic websearch settings (6 items)
 */
export function useBasicWebSearchSettings() {
  const [searchWithTime, setSearchWithTime] = usePreference('chat.websearch.search_with_time')
  const [maxResults, setMaxResults] = usePreference('chat.websearch.max_results')
  const [excludeDomains, setExcludeDomains] = usePreference('chat.websearch.exclude_domains')

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
  const [method, setMethod] = usePreference('chat.websearch.compression.method')
  return { method, setMethod }
}

/**
 * Cutoff compression settings (5 items)
 */
export function useCutoffCompression() {
  const [cutoffLimit, setCutoffLimit] = usePreference('chat.websearch.compression.cutoff_limit')
  const [cutoffUnit, setCutoffUnit] = usePreference('chat.websearch.compression.cutoff_unit')

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
