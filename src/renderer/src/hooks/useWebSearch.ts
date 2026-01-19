/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider configuration is stored directly in Preference system.
 * No merge logic needed - providers are read directly from Preference.
 */

import { usePreference } from "@data/hooks/usePreference";
import type { WebSearchProvider } from "@shared/data/preference/preferenceTypes";
import { useCallback, useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Test provider connection result
 */
export interface TestProviderResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

// ============================================================================
// Provider Hooks (Preference-based)
// ============================================================================

/**
 * Hook for managing websearch providers
 *
 * Providers are stored directly in Preference, no merge needed.
 */
export function useWebSearchProviders() {
  const [providers, setProviders] = usePreference("websearch.providers");

  /**
   * Update a specific provider by ID
   */
  const updateProvider = useCallback(
    async (providerId: string, updates: Partial<WebSearchProvider>) => {
      const index = providers.findIndex((p) => p.id === providerId);
      if (index === -1) {
        throw new Error(`Unknown provider ID: ${providerId}`);
      }

      const newProviders = [...providers];
      newProviders[index] = { ...newProviders[index], ...updates };
      await setProviders(newProviders);
    },
    [providers, setProviders],
  );

  /**
   * Get a single provider by ID
   */
  const getProvider = useCallback(
    (providerId: string): WebSearchProvider | undefined => {
      return providers.find((p) => p.id === providerId);
    },
    [providers],
  );

  return {
    providers,
    total: providers.length,
    updateProvider,
    getProvider,
  };
}

/**
 * Hook for a single websearch provider with update capability
 */
export function useWebSearchProvider(providerId: string) {
  const { updateProvider, getProvider } = useWebSearchProviders();

  const provider = useMemo(
    () => getProvider(providerId),
    [getProvider, providerId],
  );

  const update = useCallback(
    async (updates: Partial<WebSearchProvider>) => {
      await updateProvider(providerId, updates);
    },
    [updateProvider, providerId],
  );

  return {
    provider,
    updateProvider: update,
  };
}

// ============================================================================
// Settings Hooks (Preference)
// ============================================================================

/**
 * Hook for websearch settings (all preference-based settings)
 */
export function useWebSearchSettings() {
  const [searchWithTime, setSearchWithTime] = usePreference(
    "websearch.search_with_time",
  );
  const [maxResults, setMaxResults] = usePreference("websearch.max_results");
  const [excludeDomains, setExcludeDomains] = usePreference(
    "websearch.exclude_domains",
  );
  const [compression, setCompression] = usePreference("websearch.compression");

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
    setCompression,
  };
}
