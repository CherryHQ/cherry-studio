import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import type {
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  aggregateApiKeyResults,
  checkModelWithMultipleKeys,
  getModelCheckCredentialPolicy,
  ModelCheckCredentialsError,
  resolveModelCheckCredentials
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './constants'
import type { ApiKeysData } from './types'
import { useAuthenticationApiKey } from './useAuthenticationApiKey'
import { useProviderEndpoints } from './useProviderEndpoints'
import { useProviderMeta } from './useProviderMeta'

const logger = loggerService.withContext('ProviderSettings:ConnectionCheck')

function getRefetchedApiKeyEntries(value: unknown, fallback: readonly ApiKeyEntry[]): readonly ApiKeyEntry[] {
  if (typeof value !== 'object' || value === null || !('keys' in value) || !Array.isArray(value.keys)) {
    return fallback
  }

  return (value as ApiKeysData).keys
}

function createCredentialFingerprint(entries: readonly ApiKeyEntry[]) {
  return JSON.stringify(entries.map(({ id, key, label }) => ({ id, key, label: label ?? '' })))
}

/** Runs one model probe across the selected provider credentials. */
export function useProviderConnectionCheck(providerId: string) {
  const { provider, enableProvider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { data: apiKeysData, refetch: refetchApiKeys } = useProviderApiKeys(providerId)
  const { commitInputApiKeyNow, inputApiKey } = useAuthenticationApiKey()
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const { isApiKeyFieldVisible } = useProviderMeta(providerId)
  const { i18n } = useTranslation()
  const apiKeyEntries = useMemo(() => apiKeysData?.keys ?? [], [apiKeysData?.keys])
  const { canSelectApiKey, requiresApiKey } = getModelCheckCredentialPolicy(provider, isApiKeyFieldVisible)
  const credentialFingerprint = useMemo(() => createCredentialFingerprint(apiKeyEntries), [apiKeyEntries])
  const [isSingleModelChecking, setIsSingleModelChecking] = useState(false)
  const [singleModelResult, setSingleModelResult] = useState<ModelWithStatus | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const preparingCredentialsRef = useRef(false)
  const acceptedCredentialFingerprintRef = useRef<string | null>(null)
  const previousCredentialFingerprintRef = useRef(credentialFingerprint)

  const abortInFlightCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    preparingCredentialsRef.current = false
    acceptedCredentialFingerprintRef.current = null
    runIdRef.current += 1
  }, [])

  const resetSingleModelResult = useCallback(() => {
    setSingleModelResult(null)
  }, [])

  const startSingleModelCheck = useCallback(
    async ({ model, keySelection }: { model: Model; keySelection: ModelCheckKeySelection }) => {
      if (!provider) {
        return 'failed' as const
      }

      abortInFlightCheck()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const runId = ++runIdRef.current
      setIsSingleModelChecking(true)
      setSingleModelResult(null)
      let didCommitApiKey = false

      try {
        preparingCredentialsRef.current = true
        await commitInputApiKeyNow()
        didCommitApiKey = true
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        const refetched = await refetchApiKeys()
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        const latestEntries = getRefetchedApiKeyEntries(refetched, apiKeyEntries)
        acceptedCredentialFingerprintRef.current = createCredentialFingerprint(latestEntries)
        preparingCredentialsRef.current = false
        const credentials = resolveModelCheckCredentials(latestEntries, keySelection, {
          canSelectApiKey,
          requiresApiKey
        })
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
            toast.warning(i18n.t('settings.provider.enable_failed_after_connection'))
          }
        }

        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        if (result.kind === 'ok') {
          toast.success({ timeout: 2000, title: i18n.t('message.api.connection.success') })
          return 'passed' as const
        }

        return 'failed' as const
      } catch (error) {
        if (runId !== runIdRef.current || controller.signal.aborted) return 'failed' as const

        if (!didCommitApiKey) {
          logger.error('Failed to persist pending API key before model check', {
            providerId: provider.id,
            modelId: model.id,
            error
          })
          toast.error({ timeout: 8000, title: i18n.t('settings.provider.api_key.save_failed') })
        } else if (error instanceof ModelCheckCredentialsError) {
          toast.error(i18n.t('message.error.enter.api.label'))
        } else {
          logger.error('Single model check failed', { providerId: provider.id, modelId: model.id, error })
          toast.error(i18n.t('settings.models.check.failed_to_start'))
        }

        return 'failed' as const
      } finally {
        preparingCredentialsRef.current = false
        if (runId === runIdRef.current) {
          abortControllerRef.current = null
          setIsSingleModelChecking(false)
        }
      }
    },
    [
      abortInFlightCheck,
      apiKeyEntries,
      canSelectApiKey,
      commitInputApiKeyNow,
      enableProvider,
      i18n,
      models.length,
      provider,
      refetchApiKeys,
      requiresApiKey
    ]
  )

  useEffect(() => {
    abortInFlightCheck()
    setIsSingleModelChecking(false)
    setSingleModelResult(null)
  }, [abortInFlightCheck, anthropicApiHost, apiHost, inputApiKey, provider?.id])

  useEffect(() => {
    if (previousCredentialFingerprintRef.current === credentialFingerprint) return
    previousCredentialFingerprintRef.current = credentialFingerprint

    if (preparingCredentialsRef.current) {
      acceptedCredentialFingerprintRef.current = credentialFingerprint
      return
    }
    if (acceptedCredentialFingerprintRef.current === credentialFingerprint) {
      acceptedCredentialFingerprintRef.current = null
      return
    }

    abortInFlightCheck()
    setIsSingleModelChecking(false)
    setSingleModelResult(null)
  }, [abortInFlightCheck, credentialFingerprint])

  useEffect(() => () => abortInFlightCheck(), [abortInFlightCheck])

  return {
    models,
    apiKeyEntries,
    canSelectApiKey,
    requiresApiKey,
    isSingleModelChecking,
    singleModelResult,
    resetSingleModelResult,
    startSingleModelCheck
  }
}
