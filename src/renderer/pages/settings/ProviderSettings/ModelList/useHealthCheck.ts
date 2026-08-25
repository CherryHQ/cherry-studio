import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProviderById } from '@renderer/hooks/useProvider'
import i18n from '@renderer/i18n/resolver'
import {
  ModelCheckCredentialsSaveError,
  type ModelCheckCredentialsState
} from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useModelCheckCredentials'
import { useProviderEndpoints } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderEndpoints'
import type {
  ModelCheckCredential,
  ModelCheckKeySelection,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import {
  getModelHealthCheckSkipReason,
  ModelCheckCredentialsError,
  summarizeHealthResults
} from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
import type { Model } from '@shared/data/types/model'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import { checkModelsHealth } from './checkModelsHealth'

const logger = loggerService.withContext('ProviderSettings:ModelCheck')

function createModelCheckFingerprint(model: Model) {
  return JSON.stringify({
    providerId: model.providerId,
    apiModelId: model.apiModelId ?? '',
    capabilities: model.capabilities.toSorted(),
    inputModalities: model.inputModalities?.toSorted() ?? [],
    outputModalities: model.outputModalities?.toSorted() ?? [],
    endpointTypes: model.endpointTypes ?? []
  })
}

function reconcileModelStatuses(statuses: ModelWithStatus[], models: readonly Model[]) {
  let changed = false
  const currentModels = new Map(models.map((model) => [model.id, model]))
  const next: ModelWithStatus[] = []

  for (const status of statuses) {
    const currentModel = currentModels.get(status.model.id)
    if (!currentModel || createModelCheckFingerprint(currentModel) !== createModelCheckFingerprint(status.model)) {
      changed = true
      continue
    }

    if (currentModel.name !== status.model.name) {
      changed = true
      next.push({ ...status, model: currentModel })
    } else {
      next.push(status)
    }
  }

  return changed ? next : statuses
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
export function useHealthCheck(providerId: string, credentialsState: ModelCheckCredentialsState) {
  const { provider } = useProviderById(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { apiHost, anthropicApiHost } = useProviderEndpoints(provider)
  const { credentialChangeVersion, prepareCredentials } = credentialsState
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const isCheckingRef = useRef(false)
  const modelsRef = useRef(models)
  const runIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    modelsRef.current = models
  }, [models])

  const abortInFlightCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
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
        finalStatuses = reconcileModelStatuses(finalStatuses, modelsRef.current)
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
        const credentials = await prepareCredentials(keySelection, controller.signal)
        if (runIdRef.current !== runId || controller.signal.aborted) return false

        const runModels = modelsRef.current

        if (runModels.length === 0) {
          toast.error({ timeout: 5000, title: i18n.t('settings.provider.no_models_for_check') })
          return false
        }

        const initialStatuses = createInitialStatuses(runModels)
        const originalIndexes = initialStatuses.flatMap((status, index) => (status.kind === 'skipped' ? [] : [index]))
        const checkableModels = originalIndexes
          .map((index) => runModels[index])
          .filter((model): model is Model => !!model)
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
        if (error instanceof ModelCheckCredentialsSaveError) {
          logger.error('Failed to save API keys before all-model check', { providerId, error: error.cause })
        } else if (error instanceof ModelCheckCredentialsError) {
          toast.error(i18n.t('message.error.enter.api.label'))
        } else {
          logger.error('Failed to prepare all-model check', { providerId, error })
          toast.error(i18n.t('settings.models.check.failed_to_start'))
        }
        return false
      } finally {
        if (!backgroundStarted && runIdRef.current === runId) {
          abortControllerRef.current = null
          isCheckingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [abortInFlightCheck, prepareCredentials, provider, providerId, runHealthCheck]
  )

  useEffect(() => {
    abortInFlightCheck()
    setModelStatuses([])
  }, [abortInFlightCheck, anthropicApiHost, apiHost, provider?.id, providerId])

  useEffect(() => {
    abortInFlightCheck()
    setModelStatuses([])
  }, [abortInFlightCheck, credentialChangeVersion])

  useEffect(() => {
    if (isChecking) return
    setModelStatuses((current) => reconcileModelStatuses(current, models))
  }, [isChecking, models])

  useEffect(() => () => abortInFlightCheck(), [abortInFlightCheck])

  return {
    isChecking,
    modelStatuses,
    startHealthCheck
  }
}
