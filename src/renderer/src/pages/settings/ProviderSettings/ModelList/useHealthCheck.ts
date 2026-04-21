import { isRerankModel } from '@renderer/config/models/v2'
import { checkModelsHealth } from '@renderer/services/HealthCheckService'
import type { ModelWithStatus } from '@renderer/types/healthCheck'
import { HealthStatus } from '@renderer/types/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { summarizeHealthResults } from '@renderer/utils/healthCheck'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isEmpty } from 'lodash'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HealthCheckPopup from './HealthCheckPopup'

export const useHealthCheck = (provider: Provider | undefined, apiKey: string, models: Model[]) => {
  const { t } = useTranslation()
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)

  const runHealthCheck = useCallback(async () => {
    if (!provider) return

    const modelsToCheck = models.filter((model) => !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    const keys = splitApiKeyString(apiKey)

    if (keys.length === 0) {
      keys.push('')
    }

    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      apiKeys: keys
    })

    if (result.cancelled) {
      return
    }

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
        apiKeys: result.apiKeys,
        isConcurrent: result.isConcurrent,
        timeout: result.timeout
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
  }, [models, provider, apiKey, t])

  return {
    isChecking,
    modelStatuses,
    runHealthCheck
  }
}
