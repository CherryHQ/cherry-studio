import { loggerService } from '@logger'
import { checkModel } from '@renderer/services/ApiService'
import type { Model as V1Model, Provider as V1Provider } from '@renderer/types'
import { serializeHealthCheckError } from '@renderer/utils/error'

import type { ApiKeyWithStatus, ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults } from '../utils/healthCheck'
import { toV1ModelForCheckApi, toV1ProviderShim } from '../utils/v1ProviderShim'

const logger = loggerService.withContext('ProviderSettingsV2:HealthCheckService')

export async function checkModelWithMultipleKeys(
  provider: ModelCheckOptions['provider'],
  model: ModelCheckOptions['models'][number],
  apiKeys: string[],
  timeout?: number
): Promise<ApiKeyWithStatus[]> {
  const checkPromises = apiKeys.map(async (key) => {
    const startTime = Date.now()
    const v1Provider: V1Provider = toV1ProviderShim(provider, {
      apiKey: key
    })
    const v1Model: V1Model = toV1ModelForCheckApi(model)
    await checkModel(v1Provider, v1Model, timeout)
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
    }

    return {
      key: apiKeys[index],
      status: HealthStatus.FAILED,
      error: serializeHealthCheckError(result.reason)
    }
  })
}

export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelWithStatus, index: number) => void
): Promise<ModelWithStatus[]> {
  const { provider, models, apiKeys, isConcurrent, timeout } = options
  const results: ModelWithStatus[] = []

  try {
    const modelPromises = models.map(async (model, index) => {
      const keyResults = await checkModelWithMultipleKeys(provider, model, apiKeys, timeout)
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
    logger.error('[ProviderSettingsV2 HealthCheckService] Model health check failed:', error as Error)
  }

  return results
}
