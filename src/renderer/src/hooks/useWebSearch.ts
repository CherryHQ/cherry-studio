import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { splitApiKeyString } from '@renderer/utils/api'
import type {
  PreferenceDefaultScopeType,
  WebSearchCapability,
  WebSearchProvider,
  WebSearchProviderId,
  WebSearchProviderOverride
} from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useWebSearch')

export type WebSearchBasicAuthPatch = {
  username?: string
  password?: string
}

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

function trimString(value: string): string {
  return value.trim()
}

function trimStringList(values: readonly string[]): string[] {
  return values.map(trimString).filter(Boolean)
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
  const providers = useMemo<WebSearchProvider[]>(() => {
    return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
      const override = providerOverrides[preset.id]

      return {
        ...preset,
        apiKeys: trimStringList(override?.apiKeys ?? []),
        capabilities: preset.capabilities.map((capability) => {
          const capabilityOverride = override?.capabilities?.[capability.feature]

          return {
            ...capability,
            ...('apiHost' in capability && capabilityOverride?.apiHost !== undefined
              ? { apiHost: trimString(capabilityOverride.apiHost) }
              : {})
          }
        }),
        engines: trimStringList(override?.engines ?? []),
        basicAuthUsername: trimString(override?.basicAuthUsername ?? ''),
        basicAuthPassword: trimString(override?.basicAuthPassword ?? '')
      }
    })
  }, [providerOverrides])

  const defaultSearchKeywordsProvider = useMemo(
    () => providers.find((item) => item.id === defaultSearchKeywordsProviderId),
    [defaultSearchKeywordsProviderId, providers]
  )
  const defaultFetchUrlsProvider = useMemo(
    () => providers.find((item) => item.id === defaultFetchUrlsProviderId),
    [defaultFetchUrlsProviderId, providers]
  )

  const updateProvider = useCallback(
    async (providerId: WebSearchProviderId, patch: WebSearchProviderOverride) => {
      await setProviderOverrides({
        ...providerOverrides,
        [providerId]: { ...providerOverrides[providerId], ...patch }
      })
    },
    [providerOverrides, setProviderOverrides]
  )

  const getProvider = useCallback(
    (providerId: WebSearchProviderId) => providers.find((provider) => provider.id === providerId),
    [providers]
  )

  const setApiKeys = useCallback(
    (providerId: WebSearchProviderId, apiKeys: string[]) => {
      return updateProvider(providerId, { apiKeys: trimStringList(apiKeys) })
    },
    [updateProvider]
  )

  const setCapabilityApiHost = useCallback(
    (providerId: WebSearchProviderId, capability: WebSearchCapability, apiHost: string) => {
      return updateProvider(providerId, {
        capabilities: {
          ...providerOverrides[providerId]?.capabilities,
          [capability]: {
            ...providerOverrides[providerId]?.capabilities?.[capability],
            apiHost: trimString(apiHost)
          }
        }
      })
    },
    [providerOverrides, updateProvider]
  )

  const setEngines = useCallback(
    (providerId: WebSearchProviderId, engines: string[]) => {
      return updateProvider(providerId, { engines: trimStringList(engines) })
    },
    [updateProvider]
  )

  const setBasicAuth = useCallback(
    (providerId: WebSearchProviderId, patch: WebSearchBasicAuthPatch) => {
      const currentOverride = providerOverrides[providerId]
      const basicAuthUsername =
        patch.username !== undefined ? trimString(patch.username) : trimString(currentOverride?.basicAuthUsername ?? '')
      const basicAuthPassword =
        patch.password !== undefined ? trimString(patch.password) : trimString(currentOverride?.basicAuthPassword ?? '')

      return updateProvider(providerId, {
        basicAuthUsername,
        basicAuthPassword: basicAuthUsername ? basicAuthPassword : ''
      })
    },
    [providerOverrides, updateProvider]
  )

  return {
    providerOverrides,
    providers,
    defaultSearchKeywordsProvider,
    defaultFetchUrlsProvider,
    getProvider,
    updateProvider,
    setApiKeys,
    setCapabilityApiHost,
    setEngines,
    setBasicAuth,
    setDefaultSearchKeywordsProvider: (provider: WebSearchProvider) => {
      return setDefaultSearchKeywordsProviderId(provider.id)
    },
    setDefaultFetchUrlsProvider: (provider: WebSearchProvider) => {
      return setDefaultFetchUrlsProviderId(provider.id)
    }
  }
}

export const useSyncZhipuWebSearchApiKeys = () => {
  const { setApiKeys } = useWebSearchProviders()
  const { t } = useTranslation()

  return useCallback(
    (providerId: string, apiKey: string) => {
      if (providerId !== 'zhipu') {
        return
      }

      void setApiKeys('zhipu', splitApiKeyString(apiKey)).catch((error) => {
        logger.error('Failed to sync Zhipu web search API keys', { error })
        window.toast.error(t('error.diagnosis.unknown'))
      })
    },
    [setApiKeys, t]
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
        ...config,
        cutoffLimit: config.cutoffLimit !== undefined ? config.cutoffLimit : state.compressionConfig.cutoffLimit
      }
      return setPreferences({
        compressionMethod: nextConfig.method,
        cutoffLimit: normalizeWebSearchCutoffLimit(nextConfig.cutoffLimit)
      })
    }
  }
}
