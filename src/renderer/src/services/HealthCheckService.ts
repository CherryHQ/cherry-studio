import { loggerService } from '@logger'
import { Model, Provider } from '@renderer/types'
import { ApiKeyWithStatus, HealthStatus, ModelCheckOptions, ModelWithStatus } from '@renderer/types/healthCheck'
import { formatErrorMessage } from '@renderer/utils/error'
import { aggregateApiKeyResults } from '@renderer/utils/healthCheck'

import { checkModel } from './ModelService'

const logger = loggerService.withContext('HealthCheckService')

/**
 * 用多个 API 密钥检查单个模型的连通性
 */
export async function checkModelWithMultipleKeys(
  provider: Provider,
  model: Model,
  apiKeys: string[]
): Promise<ApiKeyWithStatus[]> {
  const checkPromises = apiKeys.map(async (key) => {
    const startTime = Date.now()
    // 如果 checkModel 抛出错误，让这个 promise 失败
    await checkModel({ ...provider, apiKey: key }, model)
    const latency = Date.now() - startTime

    return {
      key,
      status: HealthStatus.SUCCESS,
      latency
    }
  })

  const results = await Promise.allSettled(checkPromises)

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    } else {
      return {
        key: apiKeys[index], // 对应失败的 promise 的 key
        status: HealthStatus.FAILED,
        error: formatErrorMessage(result.reason)
      }
    }
  })
}

/**
 * 检查多个模型的连通性
 */
export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelWithStatus, index: number) => void
): Promise<ModelWithStatus[]> {
  const { provider, models, apiKeys, isConcurrent } = options
  const results: ModelWithStatus[] = []

  try {
    const modelPromises = models.map(async (model, index) => {
      const keyResults = await checkModelWithMultipleKeys(provider, model, apiKeys)
      const analysis = aggregateApiKeyResults(keyResults)

      const result: ModelWithStatus = {
        model,
        keyResults,
        status: analysis.status,
        error: analysis.error,
        latency: analysis.latency
      }

      if (isConcurrent) {
        results[index] = result
      } else {
        results.push(result)
      }

      onModelChecked?.(result, index)
      return result
    })

    if (isConcurrent) {
      await Promise.all(modelPromises)
    } else {
      for (const promise of modelPromises) {
        await promise
      }
    }
  } catch (error) {
    logger.error('[HealthCheckService] Model health check failed:', error as Error)
  }

  return results
}
