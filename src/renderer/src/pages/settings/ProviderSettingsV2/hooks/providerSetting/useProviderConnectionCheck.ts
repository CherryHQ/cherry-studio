import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { useTimer } from '@renderer/hooks/useTimer'
import { isRerankModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { type ApiKeyConnectivity, HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { formatApiKeys } from '@renderer/utils'
import { serializeHealthCheckError } from '@renderer/utils/error'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { providerCheckApiAdapter } from '../../adapters/providerCheckApiAdapter'
import SelectProviderModelPopup from '../../SelectProviderModelPopup'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useOpenApiKeyList } from './useOpenApiKeyList'
import { useProviderEndpoints } from './useProviderEndpoints'

/**
 * Boundary rule: this is a domain-cohesive connection-check hook.
 * It should internalize provider/models/timer reads, expose only connectivity state and actions,
 * and accept only the true shared values/actions it cannot resolve itself.
 * Callers should pass providerId plus shared values, never provider/models/timer wiring.
 *
 * Intent: run provider connection checks against the current editable credentials and endpoint.
 * Scope: use in Provider Settings where the user can manually verify connectivity before saving more changes.
 * Does not handle: key field ownership, endpoint field ownership, or persistence of any provider fields.
 *
 * @example
 * ```tsx
 * const connection = useProviderConnectionCheck(providerId)
 * <Button onClick={() => void connection.checkApi()}>Check</Button>
 * ```
 */
export function useProviderConnectionCheck(providerId: string) {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const { inputApiKey } = useAuthenticationApiKey()
  const { apiHost } = useProviderEndpoints(provider)
  const { openApiKeyList } = useOpenApiKeyList(providerId)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })

  const resetApiKeyConnectivity = useCallback(() => {
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED, checking: false })
  }, [])

  const checkApi = useCallback(async () => {
    if (!provider) {
      return
    }

    const formattedKey = formatApiKeys(inputApiKey)

    if (formattedKey.includes(',')) {
      await openApiKeyList()
      return
    }

    const modelsToCheck = models.filter((model) => !isRerankModel(model))
    if (isEmpty(modelsToCheck)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    const selectedModel = await SelectProviderModelPopup.show({ models })
    if (!selectedModel) {
      window.toast.error(i18n.t('message.error.enter.model'))
      return
    }

    try {
      setApiKeyConnectivity((previous) => ({
        ...previous,
        checking: true,
        status: HealthStatus.NOT_CHECKED
      }))

      await providerCheckApiAdapter({
        provider,
        models,
        selectedModel,
        apiKey: formattedKey,
        apiHost
      })

      window.toast.success({
        timeout: 2000,
        title: i18n.t('message.api.connection.success')
      })

      setApiKeyConnectivity((previous) => ({ ...previous, status: HealthStatus.SUCCESS }))
      setTimeoutTimer(
        'provider-setting-check-api',
        () => setApiKeyConnectivity((previous) => ({ ...previous, status: HealthStatus.NOT_CHECKED })),
        3000
      )
    } catch (error) {
      window.toast.error({
        timeout: 8000,
        title: i18n.t('message.api.connection.failed')
      })

      setApiKeyConnectivity((previous) => ({
        ...previous,
        status: HealthStatus.FAILED,
        error: serializeHealthCheckError(error)
      }))
    } finally {
      setApiKeyConnectivity((previous) => ({ ...previous, checking: false }))
    }
  }, [apiHost, i18n, inputApiKey, models, openApiKeyList, provider, setTimeoutTimer, t])

  const showApiKeyError = useCallback(() => {
    if (apiKeyConnectivity.error) {
      showErrorDetailPopup({ error: apiKeyConnectivity.error })
    }
  }, [apiKeyConnectivity.error])

  useEffect(() => {
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED, checking: false })
  }, [apiHost, inputApiKey, provider?.id])

  return {
    apiKeyConnectivity,
    checkApi,
    showApiKeyError,
    resetApiKeyConnectivity
  }
}
