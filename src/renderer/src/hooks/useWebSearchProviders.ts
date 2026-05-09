import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { filterSupportedWebSearchProviders } from '@renderer/config/webSearchProviders'
import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  WEB_SEARCH_PREFERENCE_KEYS
} from '@renderer/services/WebSearchService'
import type { WebSearchProvider, WebSearchProviderId, WebSearchState } from '@renderer/types'
import type { UnifiedPreferenceType, WebSearchSubscribeSource } from '@shared/data/preference/preferenceTypes'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { t } from 'i18next'
import { useMemo } from 'react'

const logger = loggerService.withContext('useWebSearchProviders')

async function safeSetWebSearchPreference(action: string, update: () => Promise<void>): Promise<void> {
  try {
    await update()
  } catch (error) {
    logger.error(`Failed to update web search preference: ${action}`, error as Error)
    window.toast.error(t('error.diagnosis.unknown'))
  }
}

function resolveRendererWebSearchProviders(
  providerOverrides: UnifiedPreferenceType['chat.web_search.provider_overrides']
) {
  return filterSupportedWebSearchProviders(resolveWebSearchProviders(providerOverrides))
}

export const useDefaultWebSearchProvider = () => {
  const [defaultProviderId, setDefaultProviderId] = usePreference('chat.web_search.default_search_keywords_provider')
  const { providers } = useWebSearchProviders()
  const provider = defaultProviderId ? providers.find((item) => item.id === defaultProviderId) : undefined

  const setDefaultProvider = (nextProvider: WebSearchProvider) => {
    return safeSetWebSearchPreference('defaultProvider', () => setDefaultProviderId(nextProvider.id))
  }

  return { provider, setDefaultProvider, updateDefaultProvider: setDefaultProvider }
}

export const useWebSearchProviders = () => {
  const [providerOverrides, setProviderOverrides] = usePreference('chat.web_search.provider_overrides')
  const resolvedProviders = useMemo(() => resolveRendererWebSearchProviders(providerOverrides), [providerOverrides])

  return {
    providers: resolvedProviders,
    updateWebSearchProviders: (nextProviders: WebSearchProvider[]) => {
      return safeSetWebSearchPreference('providerOverrides', () =>
        setProviderOverrides(buildWebSearchProviderOverrides(nextProviders))
      )
    },
    addWebSearchProvider: (provider: WebSearchProvider) => {
      const exists = resolvedProviders.some((item) => item.id === provider.id)
      if (!exists) {
        return safeSetWebSearchPreference('providerOverrides', () =>
          setProviderOverrides(buildWebSearchProviderOverrides([...resolvedProviders, provider]))
        )
      }
      return Promise.resolve()
    }
  }
}

export const useWebSearchProvider = (id: WebSearchProviderId) => {
  const [providerOverrides, setProviderOverrides] = usePreference('chat.web_search.provider_overrides')
  const providers = useMemo(() => resolveRendererWebSearchProviders(providerOverrides), [providerOverrides])
  const provider = providers.find((item) => item.id === id)

  if (!provider) {
    throw new Error(`Web search provider with id ${id} not found`)
  }

  return {
    provider,
    updateProvider: (updates: Partial<WebSearchProvider>) => {
      return safeSetWebSearchPreference('providerOverride', () =>
        setProviderOverrides(updateWebSearchProviderOverride(providerOverrides, id, updates))
      )
    }
  }
}

export const useBlacklist = () => {
  const [excludeDomains, setExcludeDomains] = usePreference('chat.web_search.exclude_domains')
  const [subscribeSources, setSubscribeSourcesPreference] = usePreference('chat.web_search.subscribe_sources')

  const addSubscribeSource = async ({ url, name, blacklist }: Omit<WebSearchSubscribeSource, 'key'>) => {
    const newKey = subscribeSources.length > 0 ? Math.max(...subscribeSources.map((item) => item.key)) + 1 : 0
    await setSubscribeSourcesPreference([...subscribeSources, { key: newKey, url, name, blacklist }])
  }

  const updateSubscribeBlacklist = async (key: number, blacklist: string[]) => {
    await setSubscribeSourcesPreference(
      subscribeSources.map((source) => (source.key === key ? { ...source, blacklist } : source))
    )
  }

  const setSubscribeSources = async (sources: WebSearchSubscribeSource[]) => {
    await setSubscribeSourcesPreference(sources)
  }

  return {
    excludeDomains,
    subscribeSources,
    setExcludeDomains,
    addSubscribeSource,
    updateSubscribeBlacklist,
    setSubscribeSources
  }
}

export const useWebSearchSettings = (): WebSearchState & {
  setMaxResults: (value: number) => Promise<void>
  setSearchWithTime: (value: boolean) => Promise<void>
  setCompressionConfig: (config: WebSearchState['compressionConfig']) => Promise<void>
  updateCompressionConfig: (config: Partial<WebSearchState['compressionConfig']>) => Promise<void>
} => {
  const [preferences, setPreferences] = useMultiplePreferences(WEB_SEARCH_PREFERENCE_KEYS)
  const state = buildRendererWebSearchState(preferences)

  return {
    ...state,
    setMaxResults: async (value: number) => {
      await safeSetWebSearchPreference('maxResults', () => setPreferences({ maxResults: value }))
    },
    setSearchWithTime: async (value: boolean) => {
      await safeSetWebSearchPreference('searchWithTime', () => setPreferences({ searchWithTime: value }))
    },
    setCompressionConfig: async (config) => {
      await safeSetWebSearchPreference('compressionConfig', () =>
        setCompressionPreferences(config, state.compressionConfig)
      )
    },
    updateCompressionConfig: async (config) => {
      const nextConfig = {
        ...state.compressionConfig,
        ...config
      }
      await safeSetWebSearchPreference('compressionConfig', () =>
        setCompressionPreferences(nextConfig, state.compressionConfig)
      )
    }
  }
}

async function setCompressionPreferences(
  nextConfig: WebSearchState['compressionConfig'],
  currentConfig: WebSearchState['compressionConfig']
) {
  const nextValues = mapCompressionConfigToPreferenceValues(nextConfig)
  const currentValues = mapCompressionConfigToPreferenceValues(currentConfig)

  for (const [key, value] of Object.entries(nextValues)) {
    if (currentValues[key as keyof UnifiedPreferenceType] === value) {
      continue
    }

    await preferenceService.set(key as keyof UnifiedPreferenceType, value)
  }
}

function mapCompressionConfigToPreferenceValues(
  config: WebSearchState['compressionConfig']
): Partial<UnifiedPreferenceType> {
  return {
    'chat.web_search.compression.method': config.method,
    'chat.web_search.compression.cutoff_limit': normalizeWebSearchCutoffLimit(config.cutoffLimit),
    'chat.web_search.compression.cutoff_unit': config.cutoffUnit ?? 'char'
  }
}
