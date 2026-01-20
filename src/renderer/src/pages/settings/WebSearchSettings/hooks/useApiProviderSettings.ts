import { loggerService } from '@logger'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import { useTimer } from '@renderer/hooks/useTimer'
import WebSearchService from '@renderer/services/webSearch/WebSearchService'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ApiProviderSettings')

type UpdatableField = 'apiKey' | 'apiHost' | 'basicAuthUsername' | 'basicAuthPassword'

interface UseApiProviderSettingsProps {
  provider: WebSearchProvider
  updateProvider: (updates: Partial<WebSearchProvider>) => void
}

export function useApiProviderSettings({ provider, updateProvider }: UseApiProviderSettingsProps) {
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()

  // Form state
  const [apiKey, setApiKey] = useState('')
  const [apiHost, setApiHost] = useState('')
  const [basicAuthUsername, setBasicAuthUsername] = useState('')
  const [basicAuthPassword, setBasicAuthPassword] = useState('')

  // UI state
  const [apiChecking, setApiChecking] = useState(false)
  const [apiValid, setApiValid] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showBasicAuthPassword, setShowBasicAuthPassword] = useState(false)

  // Sync state when provider changes - use primitive dependencies
  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHost(provider.apiHost ?? '')
    setBasicAuthUsername(provider.basicAuthUsername ?? '')
    setBasicAuthPassword(provider.basicAuthPassword ?? '')
  }, [provider.apiKey, provider.apiHost, provider.basicAuthUsername, provider.basicAuthPassword])

  // Generic field updater to reduce code duplication
  const handleFieldBlur = useCallback(
    (field: UpdatableField, localValue: string) => {
      let value = localValue || ''

      // Special handling for apiHost: trim and remove trailing slash
      if (field === 'apiHost') {
        value = value.trim().replace(/\/$/, '')
      }

      const savedValue = (provider[field] as string) || ''
      if (value !== savedValue) {
        updateProvider({ [field]: value })
      }
    },
    [provider, updateProvider]
  )

  const openApiKeyList = useCallback(async () => {
    await ApiKeyListPopup.show({
      providerId: provider.id,
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`,
      providerType: 'webSearch'
    })
  }, [provider.id, provider.name, t])

  const checkSearch = useCallback(async () => {
    if (apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    try {
      setApiChecking(true)
      const { valid, error } = await WebSearchService.checkSearch(provider)

      const errorMessage = error?.message ? ' ' + error.message : ''
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
  }, [apiKey, provider, t, setTimeoutTimer, openApiKeyList])

  const toggleShowApiKey = useCallback(() => setShowApiKey((prev) => !prev), [])
  const toggleShowBasicAuthPassword = useCallback(() => setShowBasicAuthPassword((prev) => !prev), [])

  return {
    // Form state
    apiKey,
    setApiKey,
    apiHost,
    setApiHost,
    basicAuthUsername,
    setBasicAuthUsername,
    basicAuthPassword,
    setBasicAuthPassword,

    // UI state
    apiChecking,
    apiValid,
    showApiKey,
    showBasicAuthPassword,

    // Actions
    handleFieldBlur,
    openApiKeyList,
    checkSearch,
    toggleShowApiKey,
    toggleShowBasicAuthPassword
  }
}
