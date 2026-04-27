import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { useTimer } from '@renderer/hooks/useTimer'
import { isRerankModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { type ApiKeyConnectivity, HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { serializeHealthCheckError } from '@renderer/utils/error'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { providerCheckApiAdapter } from '../../adapters/providerCheckApiAdapter'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
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
 * <Button onClick={connection.openConnectionCheck}>Check</Button>
 * ```
 */
export function useProviderConnectionCheck(providerId: string) {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const { inputApiKey } = useAuthenticationApiKey()
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })
  const [connectionCheckOpen, setConnectionCheckOpen] = useState(false)

  const checkableModels = useMemo(() => models.filter((model) => !isRerankModel(model)), [models])
  const checkableApiKeys = useMemo(() => splitApiKeyString(formatApiKeys(inputApiKey)).filter(Boolean), [inputApiKey])

  const resetApiKeyConnectivity = useCallback(() => {
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED, checking: false })
  }, [])

  const closeConnectionCheck = useCallback(() => {
    setConnectionCheckOpen(false)
  }, [])

  const openConnectionCheck = useCallback(() => {
    if (!provider) {
      return
    }

    if (isEmpty(checkableApiKeys)) {
      window.toast.error(i18n.t('message.error.enter.api.label'))
      return
    }

    if (isEmpty(checkableModels)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    setConnectionCheckOpen(true)
  }, [checkableApiKeys, checkableModels, i18n, provider, t])

  const resolveApiHostForModel = useCallback(
    (selectedModel: Model) => {
      if (selectedModel.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)) {
        return anthropicApiHost || apiHost
      }

      return apiHost
    },
    [anthropicApiHost, apiHost]
  )

  const startConnectionCheck = useCallback(
    async ({ model, apiKey }: { model?: Model; apiKey: string }) => {
      if (!provider || !model) {
        window.toast.error(i18n.t('message.error.enter.model'))
        return
      }

      if (!apiKey) {
        window.toast.error(i18n.t('message.error.enter.api.label'))
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
          selectedModel: model,
          apiKey,
          apiHost: resolveApiHostForModel(model)
        })

        window.toast.success({
          timeout: 2000,
          title: i18n.t('message.api.connection.success')
        })

        setApiKeyConnectivity((previous) => ({ ...previous, status: HealthStatus.SUCCESS }))
        setConnectionCheckOpen(false)
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
        setConnectionCheckOpen(false)
      } finally {
        setApiKeyConnectivity((previous) => ({ ...previous, checking: false }))
      }
    },
    [i18n, models, provider, resolveApiHostForModel, setTimeoutTimer]
  )

  const checkApi = useCallback(async () => {
    if (isEmpty(checkableModels)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    const firstModel = checkableModels[0]
    if (!firstModel) {
      window.toast.error(i18n.t('message.error.enter.model'))
      return
    }

    await startConnectionCheck({
      model: firstModel,
      apiKey: checkableApiKeys[0] ?? ''
    })
  }, [checkableApiKeys, checkableModels, i18n, startConnectionCheck, t])

  const showApiKeyError = useCallback(() => {
    if (apiKeyConnectivity.error) {
      showErrorDetailPopup({ error: apiKeyConnectivity.error })
    }
  }, [apiKeyConnectivity.error])

  useEffect(() => {
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED, checking: false })
    setConnectionCheckOpen(false)
  }, [anthropicApiHost, apiHost, inputApiKey, provider?.id])

  return {
    apiKeyConnectivity,
    checkableApiKeys,
    checkableModels,
    checkApi,
    connectionCheckOpen,
    openConnectionCheck,
    closeConnectionCheck,
    startConnectionCheck,
    showApiKeyError,
    resetApiKeyConnectivity
  }
}
