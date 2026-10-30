import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import type {
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  aggregateApiKeyResults,
  checkModelWithMultipleKeys,
  ModelCheckCredentialsError
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import { ModelCheckCredentialsSaveError, type ModelCheckCredentialsState } from './useModelCheckCredentials'
import { useProviderEndpoints } from './useProviderEndpoints'

const logger = loggerService.withContext('ProviderSettings:ConnectionCheck')

/** Runs one model probe across the selected provider credentials. */
export function useProviderConnectionCheck(providerId: string, credentialsState: ModelCheckCredentialsState) {
  const { provider, enableProvider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const { i18n } = useTranslation()
  const { credentialChangeVersion, prepareCredentials } = credentialsState
  const [isSingleModelChecking, setIsSingleModelChecking] = useState(false)
  const [singleModelResult, setSingleModelResult] = useState<ModelWithStatus | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const feedbackScope = useMemo(
    () => ({ active: true }),
    // Each connection/credential scope owns the callbacks retained by its toasts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerId, apiHost, anthropicApiHost, credentialChangeVersion]
  )
  useEffect(() => {
    feedbackScope.active = true
    return () => {
      feedbackScope.active = false
      toast.closeToast(`provider-check:${providerId}`)
    }
  }, [feedbackScope, providerId])

  const abortInFlightCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    runIdRef.current += 1
  }, [])

  const resetSingleModelResult = useCallback(() => {
    setSingleModelResult(null)
  }, [])

  const startSingleModelCheck = useCallback(
    async ({
      model,
      keySelection,
      notify = true
    }: {
      model: Model
      keySelection: ModelCheckKeySelection
      notify?: boolean
    }): Promise<'passed' | 'failed'> => {
      if (!provider) {
        return 'failed' as const
      }

      abortInFlightCheck()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const runId = ++runIdRef.current
      setIsSingleModelChecking(true)
      setSingleModelResult(null)
      const reportFailure = (error: unknown) =>
        toast.errorFromException(error, {
          key: `provider-check:${providerId}`,
          provider,
          modelName: model.name,
          category: error instanceof ModelCheckCredentialsError ? 'auth' : undefined,
          actions: {
            retry: async () => (await startSingleModelCheck({ model, keySelection, notify: false })) === 'passed'
          },
          isCurrent: () => feedbackScope.active
        })

      try {
        const credentials = await prepareCredentials(keySelection, controller.signal)
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        const keyResults = await checkModelWithMultipleKeys(model, credentials, 15000, controller.signal)
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        const analysis = aggregateApiKeyResults(keyResults)
        const result: ModelWithStatus =
          analysis.status === HealthStatus.SUCCESS
            ? {
                kind: 'ok',
                model,
                keyResults,
                status: HealthStatus.SUCCESS,
                checking: false,
                latency: analysis.latency
              }
            : {
                kind: 'failed',
                model,
                keyResults,
                status: HealthStatus.FAILED,
                checking: false,
                error: analysis.error,
                latency: analysis.latency
              }
        setSingleModelResult(result)

        if (keyResults.some((keyResult) => keyResult.status === HealthStatus.SUCCESS)) {
          try {
            await enableProviderWhenModelsAvailable(provider, enableProvider, models.length, 'single_model_check')
          } catch (error) {
            if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const
            logger.error('Model check succeeded but provider enablement failed', {
              providerId: provider.id,
              modelId: model.id,
              error
            })
            if (notify) toast.warning(i18n.t('settings.provider.enable_failed_after_connection'))
            else if (result.kind === 'ok') {
              throw new Error(i18n.t('settings.provider.enable_failed_after_connection'), { cause: error })
            }
          }
        }

        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        if (result.kind === 'ok') {
          if (notify) toast.success({ timeout: 2000, title: i18n.t('message.api.connection.success') })
          return 'passed' as const
        }
        // Mixed failures use credential order; keep the aggregate for the results panel.
        const error = keyResults.find((keyResult) => keyResult.kind === 'failed')?.error ?? result.error
        if (!notify) throw error ?? new Error(i18n.t('settings.models.check.failed_to_start'))
        reportFailure(error)
        return 'failed' as const
      } catch (error) {
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const
        if (error instanceof ModelCheckCredentialsSaveError) {
          logger.error('Failed to persist pending API key before model check', {
            providerId: provider.id,
            modelId: model.id,
            error: error.cause
          })
          return 'failed'
        }
        if (!notify) throw error
        if (!(error instanceof ModelCheckCredentialsError)) {
          logger.error('Single model check failed', { providerId: provider.id, modelId: model.id, error })
        }
        reportFailure(error)

        return 'failed' as const
      } finally {
        if (runId === runIdRef.current) {
          abortControllerRef.current = null
          setIsSingleModelChecking(false)
        }
      }
    },
    [abortInFlightCheck, enableProvider, i18n, models.length, prepareCredentials, provider, providerId, feedbackScope]
  )

  useEffect(() => {
    abortInFlightCheck()
    setIsSingleModelChecking(false)
    setSingleModelResult(null)
  }, [abortInFlightCheck, anthropicApiHost, apiHost, provider?.id])

  useEffect(() => {
    abortInFlightCheck()
    setIsSingleModelChecking(false)
    setSingleModelResult(null)
  }, [abortInFlightCheck, credentialChangeVersion])

  useEffect(() => () => abortInFlightCheck(), [abortInFlightCheck])

  return {
    models,
    isSingleModelChecking,
    singleModelResult,
    resetSingleModelResult,
    startSingleModelCheck
  }
}
