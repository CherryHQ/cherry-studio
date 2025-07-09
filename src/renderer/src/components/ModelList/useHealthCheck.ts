import { isRerankModel } from '@renderer/config/models'
import { checkModelsHealth } from '@renderer/services/HealthCheckService'
import { Model, Provider } from '@renderer/types'
import { HealthStatus, ModelWithStatus } from '@renderer/types/healthCheck'
import { splitApiKeyString } from '@renderer/utils/api'
import { summarizeHealthResults } from '@renderer/utils/healthCheck'
import { isEmpty } from 'lodash'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HealthCheckPopup from './HealthCheckPopup'

export const useHealthCheck = (provider: Provider, models: Model[]) => {
  const { t } = useTranslation()
  const [modelStatuses, setModelStatuses] = useState<ModelWithStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)

  const runHealthCheck = useCallback(async () => {
    const modelsToCheck = models.filter((model) => !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models_for_check')
      })
      return
    }

    const keys = splitApiKeyString(provider.apiKey)

    // 若无 key，插入空字符串以支持本地模型健康检查
    if (keys.length === 0) {
      keys.push('')
    }

    // 弹出健康检查参数配置弹窗
    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      provider,
      apiKeys: keys
    })

    if (result.cancelled) {
      return
    }

    // 初始化健康检查状态
    const initialStatuses: ModelWithStatus[] = modelsToCheck.map((model) => ({
      model,
      checking: true,
      status: HealthStatus.NOT_CHECKED,
      keyResults: []
    }))
    setModelStatuses(initialStatuses)
    setIsChecking(true)

    // 执行健康检查，逐步更新每个模型的状态
    const checkResults = await checkModelsHealth(
      {
        provider,
        models: modelsToCheck,
        apiKeys: result.apiKeys,
        isConcurrent: result.isConcurrent
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

    window.message.info({
      key: 'health-check-summary',
      style: { marginTop: '3vh' },
      duration: 5,
      content: summarizeHealthResults(checkResults, provider.name)
    })

    setIsChecking(false)
  }, [models, provider, t])

  return {
    isChecking,
    modelStatuses,
    runHealthCheck
  }
}
