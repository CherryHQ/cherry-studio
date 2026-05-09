import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { filterSupportedWebSearchProviders } from '@renderer/config/webSearchProviders'
import type { WebSearchProviderId } from '@renderer/types'
import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  type RendererWebSearchProvider,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  WEB_SEARCH_PREFERENCE_KEYS,
  type WebSearchPreferenceValues
} from '@renderer/utils/webSearchProviders'
import type { UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { t } from 'i18next'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useWebSearchProviders')
const WEB_SEARCH_PROVIDER_OVERRIDE_UPDATE_OPTIONS = { optimistic: false } as const

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

  const setDefaultProvider = (nextProvider: RendererWebSearchProvider) => {
    return safeSetWebSearchPreference('defaultProvider', () => setDefaultProviderId(nextProvider.id))
  }

  return { provider, setDefaultProvider, updateDefaultProvider: setDefaultProvider }
}

export const useDefaultFetchUrlsProvider = () => {
  const [defaultProviderId, setDefaultProviderId] = usePreference('chat.web_search.default_fetch_urls_provider')
  const { providers } = useWebSearchProviders()
  const provider = defaultProviderId ? providers.find((item) => item.id === defaultProviderId) : undefined

  const setDefaultProvider = (nextProvider: RendererWebSearchProvider) => {
    return safeSetWebSearchPreference('defaultFetchUrlsProvider', () => setDefaultProviderId(nextProvider.id))
  }

  return { provider, setDefaultProvider, updateDefaultProvider: setDefaultProvider }
}

export const useWebSearchProviders = () => {
  const [providerOverrides, setProviderOverrides] = usePreference(
    'chat.web_search.provider_overrides',
    WEB_SEARCH_PROVIDER_OVERRIDE_UPDATE_OPTIONS
  )
  const resolvedProviders = useMemo(() => resolveRendererWebSearchProviders(providerOverrides), [providerOverrides])

  return {
    providers: resolvedProviders,
    updateWebSearchProviders: (nextProviders: RendererWebSearchProvider[]) => {
      return safeSetWebSearchPreference('providerOverrides', () =>
        setProviderOverrides(buildWebSearchProviderOverrides(nextProviders))
      )
    },
    addWebSearchProvider: (provider: RendererWebSearchProvider) => {
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
  const [providerOverrides, setProviderOverrides] = usePreference(
    'chat.web_search.provider_overrides',
    WEB_SEARCH_PROVIDER_OVERRIDE_UPDATE_OPTIONS
  )
  const providers = useMemo(() => resolveRendererWebSearchProviders(providerOverrides), [providerOverrides])
  const provider = providers.find((item) => item.id === id)

  if (!provider) {
    throw new Error(`Web search provider with id ${id} not found`)
  }

  return {
    provider,
    updateProvider: (updates: Partial<RendererWebSearchProvider>) => {
      return safeSetWebSearchPreference('providerOverride', () =>
        setProviderOverrides(updateWebSearchProviderOverride(providerOverrides, id, updates))
      )
    }
  }
}

export const useUpdateWebSearchProviderOverride = () => {
  const [providerOverrides, setProviderOverrides] = usePreference(
    'chat.web_search.provider_overrides',
    WEB_SEARCH_PROVIDER_OVERRIDE_UPDATE_OPTIONS
  )

  return useCallback(
    (providerId: WebSearchProviderId, updates: Partial<RendererWebSearchProvider>) => {
      return safeSetWebSearchPreference('providerOverride', () =>
        setProviderOverrides(updateWebSearchProviderOverride(providerOverrides, providerId, updates))
      )
    },
    [providerOverrides, setProviderOverrides]
  )
}

export const useBlacklist = () => {
  const [excludeDomains, setExcludeDomains] = usePreference('chat.web_search.exclude_domains')

  return {
    excludeDomains,
    setExcludeDomains
  }
}

export const useWebSearchSettings = (): ReturnType<typeof buildRendererWebSearchState> & {
  setMaxResults: (value: number) => Promise<void>
  setCompressionConfig: (config: ReturnType<typeof buildRendererWebSearchState>['compressionConfig']) => Promise<void>
  updateCompressionConfig: (
    config: Partial<ReturnType<typeof buildRendererWebSearchState>['compressionConfig']>
  ) => Promise<void>
} => {
  const [preferences, setPreferences] = useMultiplePreferences(WEB_SEARCH_PREFERENCE_KEYS)
  const state = buildRendererWebSearchState(preferences)

  return {
    ...state,
    setMaxResults: async (value: number) => {
      await safeSetWebSearchPreference('maxResults', () => setPreferences({ maxResults: value }))
    },
    setCompressionConfig: async (config) => {
      await safeSetWebSearchPreference('compressionConfig', () =>
        setCompressionPreferences(setPreferences, config, state.compressionConfig)
      )
    },
    updateCompressionConfig: async (config) => {
      const nextConfig = {
        ...state.compressionConfig,
        ...config
      }
      await safeSetWebSearchPreference('compressionConfig', () =>
        setCompressionPreferences(setPreferences, nextConfig, state.compressionConfig)
      )
    }
  }
}

async function setCompressionPreferences(
  setPreferences: (updates: Partial<WebSearchPreferenceValues>) => Promise<void>,
  nextConfig: ReturnType<typeof buildRendererWebSearchState>['compressionConfig'],
  currentConfig: ReturnType<typeof buildRendererWebSearchState>['compressionConfig']
) {
  const nextValues = mapCompressionConfigToPreferenceValues(nextConfig)
  const currentValues = mapCompressionConfigToPreferenceValues(currentConfig)
  const updates: Partial<WebSearchPreferenceValues> = {}

  if (currentValues.compressionMethod !== nextValues.compressionMethod) {
    updates.compressionMethod = nextValues.compressionMethod
  }

  if (currentValues.cutoffLimit !== nextValues.cutoffLimit) {
    updates.cutoffLimit = nextValues.cutoffLimit
  }

  if (currentValues.cutoffUnit !== nextValues.cutoffUnit) {
    updates.cutoffUnit = nextValues.cutoffUnit
  }

  if (Object.keys(updates).length > 0) {
    await setPreferences(updates)
  }
}

function mapCompressionConfigToPreferenceValues(
  config: ReturnType<typeof buildRendererWebSearchState>['compressionConfig']
): Pick<WebSearchPreferenceValues, 'compressionMethod' | 'cutoffLimit' | 'cutoffUnit'> {
  return {
    compressionMethod: config.method,
    cutoffLimit: normalizeWebSearchCutoffLimit(config.cutoffLimit),
    cutoffUnit: config.cutoffUnit ?? 'char'
  }
}
