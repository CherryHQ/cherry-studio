import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import i18n from '@renderer/i18n'
import { checkModelsHealth } from '@renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { isRerankModel } from '@shared/utils/model'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'

const logger = loggerService.withContext('ProviderSettings:ModelHealthCheck')

export const useHealthCheck = (providerId: string) => {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [healthCheckOpen, setHealthCheckOpen] = useState(false)
  const runIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    runIdRef.current += 1
    setModelStatuses([])
    setIsChecking(false)
    setHealthCheckOpen(false)

    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [providerId])

  const enabledApiKeys = useMemo(
    () =>
      splitApiKeyString(
        apiKeysData?.keys
          ?.filter((item) => item.isEnabled)
          .map((item) => item.key)
          .join(',') ?? ''
      ),
    [apiKeysData?.keys]
  )

  const openHealthCheck = useCallback(() => {
    setHealthCheckOpen(true)
  }, [])

  const closeHealthCheck = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    runIdRef.current += 1
    setIsChecking(false)
    setHealthCheckOpen(false)
  }, [])

  const resetHealthCheckRun = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    runIdRef.current += 1
    setModelStatuses([])
    setIsChecking(false)
  }, [])

  const startHealthCheck = useCallback(
    async ({ apiKeys, isConcurrent, timeout }: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => {
      if (!provider) return

      const modelsToCheck = models.filter((model) => !isRerankModel(model))

      if (isEmpty(modelsToCheck)) {
        window.toast.error({
          timeout: 5000,
          title: i18n.t('settings.provider.no_models_for_check')
        })
        setHealthCheckOpen(false)
        return
      }

      const keys = apiKeys.length > 0 ? [...apiKeys] : ['']
      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      const runId = runIdRef.current + 1
      runIdRef.current = runId

      const initialStatuses: ModelWithStatus[] = modelsToCheck.map((model) => ({
        kind: 'checking',
        model,
        checking: true,
        status: HealthStatus.NOT_CHECKED,
        keyResults: []
      }))
      setModelStatuses(initialStatuses)
      setIsChecking(true)

      try {
        await checkModelsHealth(
          {
            models: modelsToCheck,
            apiKeys: keys,
            isConcurrent,
            timeout,
            signal: abortController.signal
          },
          (checkResult, index) => {
            if (runIdRef.current !== runId) {
              return
            }
            setModelStatuses((current) => {
              const updated = [...current]
              if (updated[index]) {
                updated[index] = checkResult
              }
              return updated
            })
          }
        )
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        if (runIdRef.current === runId) {
          logger.error('Model health check run failed', { providerId: provider.id, runId, error })
          window.toast.error(i18n.t('settings.models.check.failed_to_start'))
        }
      } finally {
        if (runIdRef.current === runId) {
          abortControllerRef.current = null
          setIsChecking(false)
        }
      }
    },
    [models, provider]
  )

  return {
    isChecking,
    modelStatuses,
    availableApiKeys: enabledApiKeys,
    healthCheckOpen,
    openHealthCheck,
    closeHealthCheck,
    resetHealthCheckRun,
    startHealthCheck
  }
}
