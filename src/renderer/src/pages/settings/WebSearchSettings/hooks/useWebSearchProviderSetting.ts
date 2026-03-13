import { loggerService } from '@logger'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import { getWebSearchProviderLogo } from '@renderer/config/webSearch/logo'
import {
  isLocalWebSearchProvider,
  WEB_SEARCH_PROVIDER_CONFIG,
  webSearchProviderRequiresApiKey,
  webSearchProviderSupportsBasicAuth
} from '@renderer/config/webSearch/provider'
import { useTimer } from '@renderer/hooks/useTimer'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import type { WebSearchProviderId } from '@renderer/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebSearchProviderSetting')

export const useWebSearchProviderSetting = (providerId: WebSearchProviderId) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHost, setApiHost] = useState(provider.apiHost || '')
  const [apiChecking, setApiChecking] = useState(false)
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername || '')
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword || '')
  const [apiValid, setApiValid] = useState(false)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHost(provider.apiHost ?? '')
    setBasicAuthUsername(provider.basicAuthUsername ?? '')
    setBasicAuthPassword(provider.basicAuthPassword ?? '')
  }, [provider.apiKey, provider.apiHost, provider.basicAuthUsername, provider.basicAuthPassword])

  const providerConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const officialWebsite = providerConfig?.websites?.official
  const providerLogo = getWebSearchProviderLogo(provider.id)
  const isLocalProvider = isLocalWebSearchProvider(provider)
  const needsApiKey = webSearchProviderRequiresApiKey(provider)
  const supportsBasicAuth = webSearchProviderSupportsBasicAuth(provider)

  const onUpdateApiKey = useCallback(() => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ apiKey })
    }
  }, [apiKey, provider.apiKey, updateProvider])

  const onUpdateApiHost = useCallback(() => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }

    if (trimmedHost !== provider.apiHost) {
      updateProvider({ apiHost: trimmedHost })
    } else {
      setApiHost(provider.apiHost || '')
    }
  }, [apiHost, provider.apiHost, updateProvider])

  const onUpdateBasicAuthUsername = useCallback(() => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''

    if (currentValue !== savedValue) {
      updateProvider({ basicAuthUsername })
    } else {
      setBasicAuthUsername(provider.basicAuthUsername || '')
    }
  }, [basicAuthUsername, provider.basicAuthUsername, updateProvider])

  const onUpdateBasicAuthPassword = useCallback(() => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''

    if (currentValue !== savedValue) {
      updateProvider({ basicAuthPassword })
    } else {
      setBasicAuthPassword(provider.basicAuthPassword || '')
    }
  }, [basicAuthPassword, provider.basicAuthPassword, updateProvider])

  const openApiKeyList = useCallback(async () => {
    await ApiKeyListPopup.show({
      providerId: provider.id,
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`
    })
  }, [provider.id, provider.name, t])

  const checkSearch = useCallback(async () => {
    if (apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    try {
      setApiChecking(true)
      const { error, valid } = await WebSearchService.checkSearch({
        ...provider,
        apiHost: apiHost.trim().replace(/\/$/, ''),
        apiKey,
        basicAuthPassword,
        basicAuthUsername
      })

      const errorMessage = error?.message ? ` ${error.message}` : ''
      window.toast[valid ? 'success' : 'error']({
        timeout: valid ? 2000 : 8000,
        title: valid
          ? t('settings.tool.websearch.check_success')
          : t('settings.tool.websearch.check_failed') + errorMessage
      })

      setApiValid(valid)
    } catch (err) {
      logger.error('Check search error:', err as Error)
      setApiValid(false)
      window.toast.error({
        timeout: 8000,
        title: t('settings.tool.websearch.check_failed')
      })
    } finally {
      setApiChecking(false)
      setTimeoutTimer('checkSearch', () => setApiValid(false), 2500)
    }
  }, [apiHost, apiKey, basicAuthPassword, basicAuthUsername, openApiKeyList, provider, setTimeoutTimer, t])

  const openLocalProviderSettings = useCallback(async () => {
    if (officialWebsite) {
      await window.api.searchService.openSearchWindow(provider.id, true)
      await window.api.searchService.openUrlInSearchWindow(provider.id, officialWebsite)
    }
  }, [officialWebsite, provider.id])

  return useMemo(
    () => ({
      apiChecking,
      apiHost,
      apiKey,
      apiKeyWebsite,
      apiValid,
      basicAuthPassword,
      basicAuthUsername,
      checkSearch,
      isLocalProvider,
      needsApiKey,
      officialWebsite,
      onUpdateApiHost,
      onUpdateApiKey,
      onUpdateBasicAuthPassword,
      onUpdateBasicAuthUsername,
      openApiKeyList,
      openLocalProviderSettings,
      provider,
      providerLogo,
      setApiHost,
      setApiKey,
      setBasicAuthPassword,
      setBasicAuthUsername,
      supportsBasicAuth
    }),
    [
      apiChecking,
      apiHost,
      apiKey,
      apiKeyWebsite,
      apiValid,
      basicAuthPassword,
      basicAuthUsername,
      checkSearch,
      isLocalProvider,
      needsApiKey,
      officialWebsite,
      onUpdateApiHost,
      onUpdateApiKey,
      onUpdateBasicAuthPassword,
      onUpdateBasicAuthUsername,
      openApiKeyList,
      openLocalProviderSettings,
      provider,
      providerLogo,
      supportsBasicAuth
    ]
  )
}
