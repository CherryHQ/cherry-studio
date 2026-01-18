/**
 * WebSearch Hooks - v2 DataApi + Preference architecture
 *
 * Migrated from useWebSearchProviders.ts (Redux-based) to use:
 * - DataApi (useQuery/useMutation) for provider CRUD operations
 * - Preference hooks for user settings
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import type { TestProviderResponse, UpdateWebSearchProviderDto } from '@shared/data/api/schemas/websearch-providers'

// ============================================================================
// Provider Hooks (DataApi)
// ============================================================================

/**
 * Hook for listing all websearch providers
 */
export function useWebSearchProviders() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/websearch-providers')
  return {
    providers: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Hook for a single websearch provider with update capability
 */
export function useWebSearchProvider(id: string) {
  const { data: provider, isLoading, error, refetch } = useQuery(`/websearch-providers/${id}`)

  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', `/websearch-providers/${id}`, {
    refresh: [`/websearch-providers/${id}`]
  })

  const updateProvider = async (updates: UpdateWebSearchProviderDto) => {
    return updateTrigger({ body: updates })
  }

  return { provider, isLoading, isUpdating, error, updateProvider, refetch }
}

/**
 * Hook for testing provider connection
 */
export function useTestWebSearchProvider(id: string) {
  const { trigger, isLoading, error } = useMutation('POST', `/websearch-providers/${id}/test`)

  const testProvider = async (): Promise<TestProviderResponse> => {
    return trigger()
  }

  return { testProvider, isLoading, error }
}

// ============================================================================
// Settings Hooks (Preference)
// ============================================================================

/**
 * Hook for websearch settings (all preference-based settings)
 */
export function useWebSearchSettings() {
  const [searchWithTime, setSearchWithTime] = usePreference('websearch.search_with_time')
  const [maxResults, setMaxResults] = usePreference('websearch.max_results')
  const [excludeDomains, setExcludeDomains] = usePreference('websearch.exclude_domains')
  const [compression, setCompression] = usePreference('websearch.compression')

  return {
    // Values
    searchWithTime,
    maxResults,
    excludeDomains,
    compression,
    // Setters
    setSearchWithTime,
    setMaxResults,
    setExcludeDomains,
    setCompression
  }
}
