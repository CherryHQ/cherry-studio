import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { buildWebSearchProviderOverrides, resolveWebSearchProviders } from '@renderer/config/webSearch/provider'
import {
  buildCompressionPreferenceUpdates,
  resolveWebSearchCompressionConfig,
  WEB_SEARCH_SETTINGS_KEYS
} from '@renderer/config/webSearch/setting'
import { useAppSelector } from '@renderer/store'
import { type CompressionConfig } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import { useCallback, useMemo } from 'react'

export const useWebSearchProviders = () => {
  const [providerOverrides, setProviderOverrides] = usePreference('chat.web_search.provider_overrides')

  const providers = useMemo(() => resolveWebSearchProviders(providerOverrides), [providerOverrides])

  const persistProviders = useCallback(
    (nextProviders: Partial<WebSearchProvider>[]) => {
      void setProviderOverrides(buildWebSearchProviderOverrides(nextProviders))
    },
    [setProviderOverrides]
  )

  const updateProvider = useCallback(
    (id: WebSearchProviderId, updates: Partial<WebSearchProvider>) => {
      const nextProviders = providers.map((provider) => (provider.id === id ? { ...provider, ...updates } : provider))
      persistProviders(nextProviders)
    },
    [persistProviders, providers]
  )

  const resetProvider = useCallback(
    (id: WebSearchProviderId) => {
      const rest = Object.fromEntries(Object.entries(providerOverrides).filter(([key]) => key !== id))
      void setProviderOverrides(rest)
    },
    [providerOverrides, setProviderOverrides]
  )

  const isCustomized = useCallback((id: WebSearchProviderId) => Boolean(providerOverrides[id]), [providerOverrides])

  return {
    providers,
    updateProvider,
    resetProvider,
    isCustomized,
    updateWebSearchProviders: persistProviders
  }
}

export const useWebSearchProvider = (id: WebSearchProviderId) => {
  const { isCustomized, providers, resetProvider, updateProvider } = useWebSearchProviders()
  const provider = providers.find((item) => item.id === id)

  if (!provider) {
    throw new Error(`Web search provider with id ${id} not found`)
  }

  return {
    provider,
    isCustomized: isCustomized(id),
    resetProvider: () => resetProvider(id),
    updateProvider: (updates: Partial<WebSearchProvider>) => {
      updateProvider(id, updates)
    }
  }
}

export const useWebSearchSettings = () => {
  const llmProviders = useAppSelector((state) => state.llm.providers)
  const [preferenceValues, updatePreferenceValues] = useMultiplePreferences(WEB_SEARCH_SETTINGS_KEYS)
  const allProviders = useMemo(() => [...llmProviders, CHERRYAI_PROVIDER], [llmProviders])
  const compressionConfig = useMemo(
    () => resolveWebSearchCompressionConfig(preferenceValues, allProviders),
    [allProviders, preferenceValues]
  )
  const setCompressionConfig = useCallback(
    async (config: CompressionConfig) => {
      await updatePreferenceValues(buildCompressionPreferenceUpdates(config))
    },
    [updatePreferenceValues]
  )

  const updateCompressionConfig = useCallback(
    async (config: Partial<CompressionConfig>) => {
      await updatePreferenceValues(
        buildCompressionPreferenceUpdates({
          ...compressionConfig,
          ...config
        })
      )
    },
    [compressionConfig, updatePreferenceValues]
  )

  return {
    searchWithTime: preferenceValues.searchWithTime,
    maxResults: preferenceValues.maxResults,
    excludeDomains: preferenceValues.excludeDomains,
    compressionConfig,
    setSearchWithTime: (searchWithTime: boolean) => updatePreferenceValues({ searchWithTime }),
    setMaxResults: (maxResults: number) => updatePreferenceValues({ maxResults }),
    setExcludeDomains: (excludeDomains: string[]) => updatePreferenceValues({ excludeDomains }),
    setCompressionConfig,
    updateCompressionConfig
  }
}
