/**
 * WebSearch Hooks - v2 Preference-based architecture
 *
 * Provider configuration is now stored in Preference system.
 * Static provider templates are merged with user configs at runtime.
 */

import { usePreference } from '@data/hooks/usePreference'
import type { WebSearchProviderConfig, WebSearchProviderConfigs } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo, useState } from 'react'

import {
  getProviderTemplate,
  WEB_SEARCH_PROVIDER_TEMPLATES,
  type WebSearchProviderTemplate,
  type WebSearchProviderType
} from '../config/webSearchProviders'

// ============================================================================
// Types
// ============================================================================

/**
 * Merged provider - template + user config
 * This is the complete provider object used at runtime
 */
export interface MergedWebSearchProvider {
  id: string
  name: string
  type: WebSearchProviderType
  apiKey: string
  apiHost: string
  engines: string[]
  usingBrowser: boolean
  basicAuthUsername: string
  basicAuthPassword: string
  websites: WebSearchProviderTemplate['websites']
}

/**
 * Test provider connection result
 */
export interface TestProviderResult {
  success: boolean
  message: string
  latencyMs?: number
}

// ============================================================================
// Provider Config Hooks (Preference-based)
// ============================================================================

/**
 * Hook for managing websearch provider configurations
 *
 * Merges static provider templates with user configurations from Preference.
 * Returns complete provider objects ready for use.
 */
export function useWebSearchProviderConfigs() {
  const [configs, setConfigs] = usePreference('websearch.providers')

  /**
   * Merge template with user config to create complete provider object
   */
  const mergeProvider = useCallback(
    (template: WebSearchProviderTemplate): MergedWebSearchProvider => {
      const userConfig = configs[template.id] ?? {}
      return {
        id: template.id,
        name: template.name,
        type: template.type,
        websites: template.websites,
        apiKey: userConfig.apiKey ?? '',
        apiHost: userConfig.apiHost ?? template.defaultApiHost ?? '',
        engines: userConfig.engines ?? [],
        usingBrowser: userConfig.usingBrowser ?? template.type === 'local',
        basicAuthUsername: userConfig.basicAuthUsername ?? '',
        basicAuthPassword: userConfig.basicAuthPassword ?? ''
      }
    },
    [configs]
  )

  /**
   * All providers with merged config
   */
  const providers = useMemo(() => WEB_SEARCH_PROVIDER_TEMPLATES.map(mergeProvider), [mergeProvider])

  /**
   * Update config for a specific provider
   */
  const updateProviderConfig = useCallback(
    async (providerId: string, updates: Partial<WebSearchProviderConfig>) => {
      const template = getProviderTemplate(providerId)
      if (!template) {
        throw new Error(`Unknown provider ID: ${providerId}`)
      }

      const currentConfig = configs[providerId] ?? {}
      const newConfigs: WebSearchProviderConfigs = {
        ...configs,
        [providerId]: {
          ...currentConfig,
          ...updates
        }
      }

      await setConfigs(newConfigs)
    },
    [configs, setConfigs]
  )

  /**
   * Get a single provider by ID
   */
  const getProvider = useCallback(
    (providerId: string): MergedWebSearchProvider | undefined => {
      const template = getProviderTemplate(providerId)
      if (!template) return undefined
      return mergeProvider(template)
    },
    [mergeProvider]
  )

  return {
    /** All providers with merged config */
    providers,
    /** Raw user configs from Preference */
    configs,
    /** Update config for a provider */
    updateProviderConfig,
    /** Get a single provider by ID */
    getProvider
  }
}

/**
 * Hook for listing all websearch providers
 *
 * This is an alias for useWebSearchProviderConfigs for backward compatibility.
 * Returns the same data structure as the previous DataApi-based implementation.
 */
export function useWebSearchProviders() {
  const { providers, configs, updateProviderConfig, getProvider } = useWebSearchProviderConfigs()

  return {
    providers,
    total: providers.length,
    configs,
    updateProviderConfig,
    getProvider
  }
}

/**
 * Hook for a single websearch provider with update capability
 */
export function useWebSearchProvider(providerId: string) {
  const { getProvider, updateProviderConfig, configs } = useWebSearchProviderConfigs()

  const provider = useMemo(() => getProvider(providerId), [getProvider, providerId])

  const updateProvider = useCallback(
    async (updates: Partial<WebSearchProviderConfig>) => {
      await updateProviderConfig(providerId, updates)
    },
    [updateProviderConfig, providerId]
  )

  return {
    provider,
    config: configs[providerId],
    updateProvider,
    // Preference is synchronous, so we never have a loading state
    isLoading: false,
    isUpdating: false
  }
}

// ============================================================================
// Test Connection Hook
// ============================================================================

/**
 * Hook for testing provider connection
 *
 * Uses the renderer WebSearchService.checkSearch method to validate provider configuration.
 */
export function useTestWebSearchProvider() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const testProvider = useCallback(async (provider: MergedWebSearchProvider): Promise<TestProviderResult> => {
    setIsLoading(true)
    setError(null)

    const startTime = Date.now()

    try {
      // Import dynamically to avoid circular dependency
      const WebSearchService = (await import('../services/WebSearchService')).default

      // Convert MergedWebSearchProvider to WebSearchProvider format expected by service
      const providerConfig = {
        id: provider.id,
        name: provider.name,
        apiKey: provider.apiKey || undefined,
        apiHost: provider.apiHost || undefined,
        engines: provider.engines.length > 0 ? provider.engines : undefined,
        usingBrowser: provider.usingBrowser,
        basicAuthUsername: provider.basicAuthUsername || undefined,
        basicAuthPassword: provider.basicAuthPassword || undefined,
        // Local providers use url field
        url: provider.type === 'local' ? provider.apiHost : undefined
      }

      const result = await WebSearchService.checkSearch(providerConfig)

      return {
        success: result.valid,
        message: result.valid ? 'Connection successful' : (result.error?.message ?? 'Connection failed'),
        latencyMs: Date.now() - startTime
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Test failed')
      setError(error)
      return {
        success: false,
        message: error.message
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

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
