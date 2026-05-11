import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { splitApiKeyString } from '@renderer/utils/api'
import { updateWebSearchProviderOverride, type WebSearchProviderUpdates } from '@renderer/utils/webSearchProviders'
import type { PreferenceDefaultScopeType, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { mergeWebSearchProviderPresets } from '@shared/data/utils/webSearchProviderMerger'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWebSearch')

type WebSearchPreferenceSnapshot = Pick<
  PreferenceDefaultScopeType,
  | 'chat.web_search.exclude_domains'
  | 'chat.web_search.max_results'
  | 'chat.web_search.compression.method'
  | 'chat.web_search.compression.cutoff_limit'
>

const WEB_SEARCH_SETTINGS_PREFERENCE_KEYS = {
  excludeDomains: 'chat.web_search.exclude_domains',
  maxResults: 'chat.web_search.max_results',
  compressionMethod: 'chat.web_search.compression.method',
  cutoffLimit: 'chat.web_search.compression.cutoff_limit'
} as const

type WebSearchPreferenceValues = {
  -readonly [K in keyof typeof WEB_SEARCH_SETTINGS_PREFERENCE_KEYS]: WebSearchPreferenceSnapshot[(typeof WEB_SEARCH_SETTINGS_PREFERENCE_KEYS)[K]]
}

type WebSearchSettingsState = {
  maxResults: number
  excludeDomains: string[]
  compressionConfig: {
    method: PreferenceDefaultScopeType['chat.web_search.compression.method']
    cutoffLimit: number
  }
}

function buildWebSearchSettingsState(preferences: WebSearchPreferenceValues): WebSearchSettingsState {
  return {
    maxResults: Math.max(1, preferences.maxResults),
    excludeDomains: preferences.excludeDomains,
    compressionConfig: {
      method: preferences.compressionMethod,
      cutoffLimit: normalizeWebSearchCutoffLimit(preferences.cutoffLimit)
    }
  }
}

export const useWebSearchProviders = () => {
  const [providerOverrides, setProviderOverrides] = usePreference('chat.web_search.provider_overrides', {
    optimistic: false
  })
  const [defaultSearchKeywordsProviderId, setDefaultSearchKeywordsProviderId] = usePreference(
    'chat.web_search.default_search_keywords_provider'
  )
  const [defaultFetchUrlsProviderId, setDefaultFetchUrlsProviderId] = usePreference(
    'chat.web_search.default_fetch_urls_provider'
  )
  const providers = useMemo(() => mergeWebSearchProviderPresets(providerOverrides), [providerOverrides])

  const defaultSearchKeywordsProvider = useMemo(
    () => providers.find((item) => item.id === defaultSearchKeywordsProviderId),
    [defaultSearchKeywordsProviderId, providers]
  )
  const defaultFetchUrlsProvider = useMemo(
    () => providers.find((item) => item.id === defaultFetchUrlsProviderId),
    [defaultFetchUrlsProviderId, providers]
  )

  const updateProviderOverride = useCallback(
    (providerId: WebSearchProviderId, updates: WebSearchProviderUpdates) => {
      return setProviderOverrides(updateWebSearchProviderOverride(providerOverrides, providerId, updates))
    },
    [providerOverrides, setProviderOverrides]
  )

  const getProvider = useCallback(
    (providerId: WebSearchProviderId) => providers.find((provider) => provider.id === providerId),
    [providers]
  )

  const updateProvider = useCallback(
    (providerId: WebSearchProviderId, updates: WebSearchProviderUpdates) => {
      return updateProviderOverride(providerId, updates)
    },
    [updateProviderOverride]
  )

  return {
    providers,
    defaultSearchKeywordsProvider,
    defaultFetchUrlsProvider,
    getProvider,
    updateProvider,
    updateProviderOverride,
    setDefaultSearchKeywordsProvider: (provider: ResolvedWebSearchProvider) => {
      return setDefaultSearchKeywordsProviderId(provider.id)
    },
    setDefaultFetchUrlsProvider: (provider: ResolvedWebSearchProvider) => {
      return setDefaultFetchUrlsProviderId(provider.id)
    }
  }
}

export const useSyncZhipuWebSearchApiKeys = () => {
  const { updateProvider } = useWebSearchProviders()
  const { t } = useTranslation()

  return useCallback(
    (providerId: string, apiKey: string) => {
      if (providerId !== 'zhipu') {
        return
      }

      void updateProvider('zhipu', { apiKeys: splitApiKeyString(apiKey) }).catch((error) => {
        logger.error('Failed to sync Zhipu web search API keys', { error })
        window.toast.error(t('error.diagnosis.unknown'))
      })
    },
    [t, updateProvider]
  )
}

export const useWebSearchSettings = (): WebSearchSettingsState & {
  setExcludeDomains: (value: string[]) => Promise<void>
  setMaxResults: (value: number) => Promise<void>
  setCompressionConfig: (config: WebSearchSettingsState['compressionConfig']) => Promise<void>
  updateCompressionConfig: (config: Partial<WebSearchSettingsState['compressionConfig']>) => Promise<void>
} => {
  const [preferences, setPreferences] = useMultiplePreferences(WEB_SEARCH_SETTINGS_PREFERENCE_KEYS)
  const state = buildWebSearchSettingsState(preferences)

  return {
    ...state,
    setExcludeDomains: (value) => {
      return setPreferences({ excludeDomains: value })
    },
    setMaxResults: (value) => {
      return setPreferences({ maxResults: value })
    },
    setCompressionConfig: (config) => {
      return setPreferences({
        compressionMethod: config.method,
        cutoffLimit: normalizeWebSearchCutoffLimit(config.cutoffLimit)
      })
    },
    updateCompressionConfig: (config) => {
      const nextConfig = {
        ...state.compressionConfig,
        ...config
      }
      return setPreferences({
        compressionMethod: nextConfig.method,
        cutoffLimit: normalizeWebSearchCutoffLimit(nextConfig.cutoffLimit)
      })
    }
  }
}
