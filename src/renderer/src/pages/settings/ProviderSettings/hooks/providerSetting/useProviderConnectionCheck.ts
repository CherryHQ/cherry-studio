import { loggerService } from '@logger'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { useTimer } from '@renderer/hooks/useTimer'
import { type ApiKeyConnectivity, HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { toV1ModelForCheckApi, toV1ProviderShim } from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import { checkApi as runCheckApi } from '@renderer/services/ApiService'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { serializeHealthCheckError } from '@renderer/utils/error'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { isRerankModel } from '@shared/utils/model'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderEndpoints } from './useProviderEndpoints'

/** Runs provider connection checks against the current editable credentials and endpoint. */
const logger = loggerService.withContext('ProviderSettings:ConnectionCheck')

export function useProviderConnectionCheck(providerId: string) {
  const { provider } = useProvider(providerId)
  const [connectionCheckOpen, setConnectionCheckOpen] = useState(false)
  const { models } = useModels(
    { providerId },
    { fetchEnabled: connectionCheckOpen, swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS }
  )
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const { inputApiKey } = useAuthenticationApiKey()
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    kind: 'idle',
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })

  const checkableModels = useMemo(() => models.filter((model) => !isRerankModel(model)), [models])
  const checkableApiKeys = useMemo(() => splitApiKeyString(formatApiKeys(inputApiKey)).filter(Boolean), [inputApiKey])

  const resetApiKeyConnectivity = useCallback(() => {
    setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false })
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

    setConnectionCheckOpen(true)
  }, [checkableApiKeys, i18n, provider])

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
        setApiKeyConnectivity({ kind: 'checking', checking: true, status: HealthStatus.NOT_CHECKED, model })

        // Transitional bridge: connection checking still calls the legacy
        // ApiService `checkApi` path, which expects v1 provider/model shapes.
        // Remove this conversion once that check path consumes runtime
        // Data API entities directly.
        const v1Provider = toV1ProviderShim(provider, {
          models,
          apiKey,
          apiHost: resolveApiHostForModel(model)
        })

        await runCheckApi(v1Provider, toV1ModelForCheckApi(model))

        window.toast.success({
          timeout: 2000,
          title: i18n.t('message.api.connection.success')
        })

        setApiKeyConnectivity({ kind: 'ok', checking: false, status: HealthStatus.SUCCESS, model })
        setConnectionCheckOpen(false)
        setTimeoutTimer(
          'provider-setting-check-api',
          () => setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false }),
          3000
        )
      } catch (error) {
        logger.error('Provider connection check failed', { providerId: provider.id, modelId: model.id, error })
        window.toast.error({
          timeout: 8000,
          title: i18n.t('message.api.connection.failed')
        })

        setApiKeyConnectivity({
          kind: 'failed',
          checking: false,
          status: HealthStatus.FAILED,
          model,
          error: serializeHealthCheckError(error)
        })
        setConnectionCheckOpen(false)
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
    setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false })
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
