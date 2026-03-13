import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { buildWebSearchProviderOverrides, resolveWebSearchProviders } from '@renderer/config/webSearch/provider'
import {
  buildCompressionPreferenceUpdates,
  resolveWebSearchCompressionConfig,
  WEB_SEARCH_SETTINGS_KEYS
} from '@renderer/config/webSearch/setting'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addSubscribeSource as _addSubscribeSource,
  type CompressionConfig,
  removeSubscribeSource as _removeSubscribeSource,
  setDefaultProvider as _setDefaultProvider,
  setSubscribeSources as _setSubscribeSources,
  updateSubscribeBlacklist as _updateSubscribeBlacklist
} from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import { useCallback, useMemo } from 'react'

/**
 * @deprecated
 * Hook to get the default web search provider
 */
export const useDefaultWebSearchProvider = () => {
  const defaultProvider = useAppSelector((state) => state.websearch.defaultProvider)
  const { providers, updateProvider } = useWebSearchProviders()
  const provider = defaultProvider ? providers.find((item) => item.id === defaultProvider) : undefined
  const dispatch = useAppDispatch()

  const setDefaultProvider = (nextProvider: WebSearchProvider) => {
    dispatch(_setDefaultProvider(nextProvider.id))
  }

  const updateDefaultProvider = (nextProvider: WebSearchProvider) => {
    updateProvider(nextProvider.id, nextProvider)
  }

  return { provider, setDefaultProvider, updateDefaultProvider }
}

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

/**
 * @deprecated Blacklist is no longer an active feature. Kept temporarily for legacy settings UI until removal.
 */
export const useBlacklist = () => {
  const dispatch = useAppDispatch()
  const websearch = useAppSelector((state) => state.websearch)

  const addSubscribeSource = ({ url, name, blacklist }) => {
    dispatch(_addSubscribeSource({ url, name, blacklist }))
  }

  const removeSubscribeSource = (key: number) => {
    dispatch(_removeSubscribeSource(key))
  }

  const updateSubscribeBlacklist = (key: number, blacklist: string[]) => {
    dispatch(_updateSubscribeBlacklist({ key, blacklist }))
  }

  const setSubscribeSources = (sources: { key: number; url: string; name: string; blacklist?: string[] }[]) => {
    dispatch(_setSubscribeSources(sources))
  }

  return {
    websearch,
    addSubscribeSource,
    removeSubscribeSource,
    updateSubscribeBlacklist,
    setSubscribeSources
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
