import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { type ApiKeyConnectivity, HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { checkApi as runCheckApi } from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { toast } from '@renderer/services/toast'
import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { serializeHealthCheckError } from '@renderer/utils/error'
import type { Model } from '@shared/data/types/model'
import { isNoApiKeyProvider } from '@shared/utils/provider'
import { isEmpty } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderEndpoints } from './useProviderEndpoints'

/** Runs provider connection checks against the current editable credentials and endpoint. */
const logger = loggerService.withContext('ProviderSettings:ConnectionCheck')

export function useProviderConnectionCheck(providerId: string) {
  const { provider, enableProvider } = useProvider(providerId)
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
  const requiresApiKey = !isNoApiKeyProvider(provider)
  const checkableApiKeySignature = JSON.stringify(checkableApiKeys)

  // AbortController + runId pair guards against stale callbacks landing on the
  // new mount/credentials. When provider/apiHost/effective API keys change mid-flight
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

    if (requiresApiKey && isEmpty(checkableApiKeys)) {
      toast.error(i18n.t('message.error.enter.api.label'))
      return
    }

    setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false })
    setConnectionCheckOpen(true)
  }, [checkableApiKeys, i18n, provider, requiresApiKey])

  const startConnectionCheck = useCallback(
    async ({ model, apiKey }: { model?: Model; apiKey: string }) => {
      if (!provider || !model) {
        toast.error(i18n.t('message.error.enter.model'))
        return
      }

      if (requiresApiKey && !apiKey) {
        toast.error(i18n.t('message.error.enter.api.label'))
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

        // Persist the pending key BEFORE running the check so a key typed within
        // the input debounce window is not lost. The probe itself uses the
        // selected key override below instead of the provider's rotated key.
        await commitInputApiKeyNow()
        didCommitApiKey = true

        if (runId !== runIdRef.current || controller.signal.aborted) return

        await runCheckApi(model.id, { apiKey: apiKey || undefined, signal: controller.signal })

        if (runId !== runIdRef.current) return

        // Enable the provider (if disabled) only after a successful check. This
        // is part of the user-visible success path, so an enable failure must
        // surface as a failed check instead of being hidden by a success state.
        const enablement = await enableProviderWhenModelsAvailable(
          provider,
          enableProvider,
          checkableModels.length,
          'connection_check'
        )
        if (enablement.status === 'failed') {
          throw enablement.error
        }

        // The enable await can interleave with a newer check; drop this run if it
        // was superseded or aborted before touching success state.
        if (runId !== runIdRef.current || controller.signal.aborted) return

        toast.success({
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
        if (!didCommitApiKey) {
          toast.error({
            timeout: 8000,
            title: i18n.t('settings.provider.api_key.save_failed')
          })
        }

        setApiKeyConnectivity({
          kind: 'failed',
          checking: false,
          status: HealthStatus.FAILED,
          model,
          error: serializeHealthCheckError(error)
        })
      }
    },
    [
      abortInFlightCheck,
      checkableModels.length,
      commitInputApiKeyNow,
      i18n,
      provider,
      requiresApiKey,
      setTimeoutTimer,
      enableProvider
    ]
  )

  const checkApi = useCallback(async () => {
    if (isEmpty(checkableModels)) {
      toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    const firstModel = checkableModels[0]
    if (!firstModel) {
      toast.error(i18n.t('message.error.enter.model'))
      return
    }

    await startConnectionCheck({
      model: firstModel,
      apiKey: checkableApiKeys[0] ?? ''
    })
  }, [checkableApiKeys, checkableModels, i18n, startConnectionCheck, t])

  useEffect(() => {
    // Provider / host / apiKey changed mid-flight: abort the in-flight check so
    // its late then/catch doesn't land on the new credentials.
    abortInFlightCheck()
    setApiKeyConnectivity({ kind: 'idle', status: HealthStatus.NOT_CHECKED, checking: false })
    setConnectionCheckOpen(false)
  }, [abortInFlightCheck, anthropicApiHost, apiHost, checkableApiKeySignature, provider?.id])

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
    requiresApiKey,
    resetApiKeyConnectivity
  }
}
