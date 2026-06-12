import { loggerService } from '@logger'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { type ApiKeyConnectivity, HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { checkApi as runCheckApi } from '@renderer/services/ApiService'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { serializeHealthCheckError } from '@renderer/utils/error'
import type { Model } from '@shared/data/types/model'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderEndpoints } from './useProviderEndpoints'

/** Runs provider connection checks against the current editable credentials and endpoint. */
const logger = loggerService.withContext('ProviderSettings:ConnectionCheck')

export function useProviderConnectionCheck(providerId: string) {
  const { provider, updateProvider } = useProvider(providerId)
  const [connectionCheckOpen, setConnectionCheckOpen] = useState(false)
  const { models } = useModels(
    { providerId },
    { fetchEnabled: connectionCheckOpen, swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS }
  )
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const { commitInputApiKeyNow, inputApiKey } = useAuthenticationApiKey()
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    kind: 'idle',
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })

  const checkableModels = models
  const checkableApiKeys = useMemo(() => splitApiKeyString(formatApiKeys(inputApiKey)).filter(Boolean), [inputApiKey])

  // AbortController + runId pair guards against stale callbacks landing on the
  // new mount/credentials. When provider/apiHost/inputApiKey changes mid-flight
  // we abort the in-flight request and bump runId so any late then/catch from
  // the aborted run is dropped before touching state.
  const abortControllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const abortInFlightCheck = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    runIdRef.current += 1
  }, [])

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

      abortInFlightCheck()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const runId = ++runIdRef.current
      // Distinguishes a local save failure from a real probe failure in the
      // catch, so the user isn't sent debugging network/key when persistence broke.
      let didCommitApiKey = false

      try {
        setApiKeyConnectivity({ kind: 'checking', checking: true, status: HealthStatus.NOT_CHECKED, model })

        // Persist the pending key BEFORE running the check. The check resolves
        // credentials from the saved provider (getRotatedApiKey in main), so
        // without flushing first it would validate a stale saved key: a new bad
        // key typed within the input debounce window could pass against an old
        // good key and then enable the provider on never-checked credentials.
        // If saving fails it throws into the catch, surfacing only the failure
        // path. Committing changes provider.apiKeys but not provider.id / host /
        // inputApiKey, so it does not trip the abort effect.
        await commitInputApiKeyNow()
        didCommitApiKey = true

        if (runId !== runIdRef.current || controller.signal.aborted) return

        await runCheckApi(model.id, { signal: controller.signal })

        if (runId !== runIdRef.current) return

        // Enable the provider (if disabled) only after a successful check. Enable
        // swallows its own errors, so it never diverts to the failure path.
        await enableProviderWhenModelsAvailable(provider, updateProvider, checkableModels.length, 'connection_check')

        // The enable await can interleave with a newer check; drop this run if it
        // was superseded or aborted before touching success state.
        if (runId !== runIdRef.current || controller.signal.aborted) return

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
        if (runId !== runIdRef.current || controller.signal.aborted) return

        if (didCommitApiKey) {
          logger.error('Provider connection check failed', { providerId: provider.id, modelId: model.id, error })
        } else {
          logger.error('Failed to persist pending API key before connection check', {
            providerId: provider.id,
            modelId: model.id,
            error
          })
        }
        window.toast.error({
          timeout: 8000,
          title: i18n.t(didCommitApiKey ? 'message.api.connection.failed' : 'settings.provider.api_key.save_failed')
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
    [abortInFlightCheck, checkableModels.length, commitInputApiKeyNow, i18n, provider, setTimeoutTimer, updateProvider]
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
    // Provider / host / apiKey changed mid-flight: abort the in-flight check so
    // its late then/catch doesn't land on the new credentials.
    abortInFlightCheck()
    setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false })
    setConnectionCheckOpen(false)
  }, [abortInFlightCheck, anthropicApiHost, apiHost, inputApiKey, provider?.id])

  useEffect(() => () => abortInFlightCheck(), [abortInFlightCheck])

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
