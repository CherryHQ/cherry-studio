import { useModels } from '@renderer/hooks/useModels'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import i18n from '@renderer/i18n'
import { checkModelsHealth } from '@renderer/pages/settings/ProviderSettings/services/HealthCheckService'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { isRerankModel } from '@shared/utils/model'
import { isEmpty } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'

export const useHealthCheck = (providerId: string) => {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [healthCheckOpen, setHealthCheckOpen] = useState(false)
  const runIdRef = useRef(0)

  useEffect(() => {
    runIdRef.current += 1
    setModelStatuses([])
    setIsChecking(false)
    setHealthCheckOpen(false)
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
    runIdRef.current += 1
    setIsChecking(false)
    setHealthCheckOpen(false)
  }, [])

  const resetHealthCheckRun = useCallback(() => {
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
      const runId = runIdRef.current + 1
      runIdRef.current = runId

      const initialStatuses: ModelWithStatus[] = modelsToCheck.map((model) => ({
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
            provider,
            models: modelsToCheck,
            apiKeys: keys,
            isConcurrent,
            timeout
          },
          (checkResult, index) => {
            if (runIdRef.current !== runId) {
              return
            }
            setModelStatuses((current) => {
              const updated = [...current]
              if (updated[index]) {
                updated[index] = {
                  ...updated[index],
                  ...checkResult,
                  checking: false
                }
              }
              return updated
            })
          }
        )
      } catch {
        if (runIdRef.current === runId) {
          window.toast.error(i18n.t('settings.models.check.failed_to_start'))
        }
      } finally {
        if (runIdRef.current === runId) {
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
