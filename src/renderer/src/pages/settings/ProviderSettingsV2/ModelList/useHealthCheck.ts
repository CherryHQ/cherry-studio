import { useModels } from '@renderer/hooks/useModels'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import i18n from '@renderer/i18n'
import { isRerankModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { checkModelsHealth } from '@renderer/pages/settings/ProviderSettingsV2/services/HealthCheckService'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { summarizeHealthResults } from '@renderer/pages/settings/ProviderSettingsV2/utils/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { isEmpty } from 'lodash'
import { useCallback, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'

export const useHealthCheck = (providerId: string) => {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [healthCheckOpen, setHealthCheckOpen] = useState(false)

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
    setHealthCheckOpen(false)
  }, [])

  const startHealthCheck = useCallback(
    async ({ apiKeys, isConcurrent, timeout }: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => {
      setHealthCheckOpen(false)

      if (!provider) return

      const modelsToCheck = models.filter((model) => !isRerankModel(model))

      if (isEmpty(modelsToCheck)) {
        window.toast.error({
          timeout: 5000,
          title: i18n.t('settings.provider.no_models_for_check')
        })
        return
      }

      const keys = apiKeys.length > 0 ? [...apiKeys] : ['']

      const initialStatuses: ModelWithStatus[] = modelsToCheck.map((model) => ({
        model,
        checking: true,
        status: HealthStatus.NOT_CHECKED,
        keyResults: []
      }))
      setModelStatuses(initialStatuses)
      setIsChecking(true)

      const checkResults = await checkModelsHealth(
        {
          provider,
          models: modelsToCheck,
          apiKeys: keys,
          isConcurrent,
          timeout
        },
        (checkResult, index) => {
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

      window.toast.info({
        timeout: 5000,
        title: summarizeHealthResults(checkResults, provider.name)
      })

      setIsChecking(false)
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
    startHealthCheck
  }
}
