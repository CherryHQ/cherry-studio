import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import i18n from '@renderer/i18n/resolver'
import type { ApiKeysData } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/types'
import { useAuthenticationApiKey } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useAuthenticationApiKey'
import { useProviderEndpoints } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderEndpoints'
import { useProviderMeta } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderMeta'
import type {
  ModelCheckCredential,
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  getModelCheckCredentialPolicy,
  getModelHealthCheckSkipReason,
  ModelCheckCredentialsError,
  resolveModelCheckCredentials,
  summarizeHealthResults
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import { checkModelsHealth } from './checkModelsHealth'

const logger = loggerService.withContext('ProviderSettings:ModelCheck')

function getRefetchedApiKeyEntries(value: unknown, fallback: readonly ApiKeyEntry[]): readonly ApiKeyEntry[] {
  if (typeof value !== 'object' || value === null || !('keys' in value) || !Array.isArray(value.keys)) {
    return fallback
  }

  return (value as ApiKeysData).keys
}

function createCredentialFingerprint(entries: readonly ApiKeyEntry[]) {
  return JSON.stringify(entries.map(({ id, key, label }) => ({ id, key, label: label ?? '' })))
}

function createInitialStatuses(models: readonly Model[]) {
  return models.map<ModelWithStatus>((model) => {
    const skipReason = getModelHealthCheckSkipReason(model)
    return skipReason
      ? {
          kind: 'skipped',
          model,
          checking: false,
          status: HealthStatus.NOT_CHECKED,
          keyResults: [],
          skipReason
        }
      : {
          kind: 'checking',
          model,
          checking: true,
          status: HealthStatus.NOT_CHECKED,
          keyResults: []
        }
  })
}

/** Runs a provider-wide model check in the background and streams row results. */
export function useHealthCheck(providerId: string) {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { data: apiKeysData, refetch: refetchApiKeys } = useProviderApiKeys(providerId)
  const { commitInputApiKeyNow, inputApiKey } = useAuthenticationApiKey()
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const { isApiKeyFieldVisible } = useProviderMeta(providerId)
  const apiKeyEntries = useMemo(() => apiKeysData?.keys ?? [], [apiKeysData?.keys])
  const { canSelectApiKey, requiresApiKey } = getModelCheckCredentialPolicy(provider, isApiKeyFieldVisible)
  const credentialFingerprint = useMemo(() => createCredentialFingerprint(apiKeyEntries), [apiKeyEntries])
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const isCheckingRef = useRef(false)
  const runIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const preparingCredentialsRef = useRef(false)
  const acceptedCredentialFingerprintRef = useRef<string | null>(null)
  const previousCredentialFingerprintRef = useRef(credentialFingerprint)

  const abortInFlightCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    preparingCredentialsRef.current = false
    acceptedCredentialFingerprintRef.current = null
    runIdRef.current += 1
    isCheckingRef.current = false
    setIsChecking(false)
  }, [])

  const runHealthCheck = useCallback(
    async ({
      runId,
      controller,
      initialStatuses,
      checkableModels,
      originalIndexes,
      credentials,
      isConcurrent,
      timeout
    }: {
      runId: number
      controller: AbortController
      initialStatuses: ModelWithStatus[]
      checkableModels: Model[]
      originalIndexes: number[]
      credentials: ModelCheckCredential[]
      isConcurrent: boolean
      timeout: number
    }) => {
      let finalStatuses = initialStatuses

      try {
        const checkedResults = await checkModelsHealth(
          {
            models: checkableModels,
            credentials,
            isConcurrent,
            timeout,
            signal: controller.signal
          },
          (checkResult, index) => {
            if (runIdRef.current !== runId || controller.signal.aborted) return
            const originalIndex = originalIndexes[index]
            if (originalIndex == null) return

            setModelStatuses((current) => {
              const updated = [...current]
              updated[originalIndex] = checkResult
              return updated
            })
          }
        )
        if (runIdRef.current !== runId || controller.signal.aborted) return

        finalStatuses = [...initialStatuses]
        checkedResults.forEach((result, index) => {
          const originalIndex = originalIndexes[index]
          if (originalIndex != null) finalStatuses[originalIndex] = result
        })
        setModelStatuses(finalStatuses)
        toast.success(summarizeHealthResults(finalStatuses, provider?.name))
      } catch (error) {
        if (runIdRef.current !== runId || controller.signal.aborted) return
        logger.error('All-model check failed', { providerId, runId, error })
        toast.error(i18n.t('settings.models.check.failed_to_start'))
      } finally {
        if (runIdRef.current === runId) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [provider?.name, providerId]
  )

  const startHealthCheck = useCallback(
    async ({
      keySelection,
      isConcurrent,
      timeout
    }: {
      keySelection: ModelCheckKeySelection
      isConcurrent: boolean
      timeout: number
    }) => {
      if (!provider || isCheckingRef.current) return false

      abortInFlightCheck()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const runId = ++runIdRef.current
      isCheckingRef.current = true
      setIsChecking(true)
      let backgroundStarted = false

      try {
        preparingCredentialsRef.current = true
        await commitInputApiKeyNow()
        if (runIdRef.current !== runId || controller.signal.aborted) return false

        const refetched = await refetchApiKeys()
        if (runIdRef.current !== runId || controller.signal.aborted) return false

        const latestEntries = getRefetchedApiKeyEntries(refetched, apiKeyEntries)
        acceptedCredentialFingerprintRef.current = createCredentialFingerprint(latestEntries)
        preparingCredentialsRef.current = false
        const credentials = resolveModelCheckCredentials(latestEntries, keySelection, {
          canSelectApiKey,
          requiresApiKey
        })

        if (models.length === 0) {
          toast.error({ timeout: 5000, title: i18n.t('settings.provider.no_models_for_check') })
          return false
        }

        const initialStatuses = createInitialStatuses(models)
        const originalIndexes = initialStatuses.flatMap((status, index) => (status.kind === 'skipped' ? [] : [index]))
        const checkableModels = originalIndexes.map((index) => models[index]).filter((model): model is Model => !!model)
        setModelStatuses(initialStatuses)

        if (checkableModels.length === 0) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
          toast.success(summarizeHealthResults(initialStatuses, provider.name))
          return true
        }

        backgroundStarted = true
        void runHealthCheck({
          runId,
          controller,
          initialStatuses,
          checkableModels,
          originalIndexes,
          credentials,
          isConcurrent,
          timeout
        })
        return true
      } catch (error) {
        if (runIdRef.current !== runId || controller.signal.aborted) return false
        if (error instanceof ModelCheckCredentialsError) {
          toast.error(i18n.t('message.error.enter.api.label'))
        } else {
          logger.error('Failed to prepare all-model check', { providerId, error })
        }
        return false
      } finally {
        preparingCredentialsRef.current = false
        if (!backgroundStarted && runIdRef.current === runId) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [
      abortInFlightCheck,
      apiKeyEntries,
      canSelectApiKey,
      commitInputApiKeyNow,
      models,
      provider,
      providerId,
      refetchApiKeys,
      requiresApiKey,
      runHealthCheck
    ]
  )

  const resetHealthCheckRun = useCallback(() => {
    if (!isCheckingRef.current) setModelStatuses([])
  }, [])

  useEffect(() => {
    abortInFlightCheck()
    setModelStatuses([])
  }, [abortInFlightCheck, anthropicApiHost, apiHost, inputApiKey, provider?.id, providerId])

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
    setModelStatuses([])
  }, [abortInFlightCheck, credentialFingerprint])

  useEffect(() => {
    if (isCheckingRef.current) return
    const currentModelIds = new Set(models.map((model) => model.id))
    setModelStatuses((current) => {
      const next = current.filter((status) => currentModelIds.has(status.model.id))
      return next.length === current.length ? current : next
    })
  }, [models])

  useEffect(() => () => abortInFlightCheck(), [abortInFlightCheck])

  return {
    isChecking,
    modelStatuses,
    apiKeyEntries,
    requiresApiKey,
    resetHealthCheckRun,
    startHealthCheck
  }
}
