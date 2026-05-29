import { loggerService } from '@logger'
import { checkModel } from '@renderer/services/ApiService'
import type { Model as V1Model, Provider as V1Provider } from '@renderer/types'
import { serializeHealthCheckError } from '@renderer/utils/error'

import type { ApiKeyWithStatus, ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults } from '../utils/healthCheck'
import { toV1ModelForCheckApi, toV1ProviderShim } from '../utils/v1ProviderShim'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

export async function checkModelWithMultipleKeys(
  provider: ModelCheckOptions['provider'],
  model: ModelCheckOptions['models'][number],
  apiKeys: string[],
  modelsForShim: ModelCheckOptions['models'],
  timeout?: number,
  signal?: AbortSignal
): Promise<ApiKeyWithStatus[]> {
  const checkPromises = apiKeys.map(async (key) => {
    signal?.throwIfAborted()
    const startTime = Date.now()
    // Transitional bridge: `checkModel` still runs through the legacy
    // ApiService/aiCore health-check path, so ProviderSettings converts the
    // runtime provider/model shapes at the edge until that stack is migrated.
    const v1Provider: V1Provider = toV1ProviderShim(provider, {
      apiKey: key,
      models: modelsForShim
    })
    const v1Model: V1Model = toV1ModelForCheckApi(model)
    await checkModel(v1Provider, v1Model, timeout, signal)
    const latency = Date.now() - startTime

    return {
      kind: 'ok',
      key,
      status: HealthStatus.SUCCESS,
      checking: false,
      latency
    } satisfies ApiKeyWithStatus
  })

  const results = await Promise.allSettled(checkPromises)

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    }

    return {
      kind: 'failed',
      key: apiKeys[index],
      status: HealthStatus.FAILED,
      checking: false,
      error: serializeHealthCheckError(result.reason)
    } satisfies ApiKeyWithStatus
  })
}

export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelWithStatus, index: number) => void
): Promise<ModelWithStatus[]> {
  const { provider, models, apiKeys, isConcurrent, timeout, signal } = options
  const results: ModelWithStatus[] = []

  try {
    const runModelCheck = async (model: ModelCheckOptions['models'][number], index: number) => {
      signal?.throwIfAborted()
      const keyResults = await checkModelWithMultipleKeys(provider, model, apiKeys, models, timeout, signal)
      signal?.throwIfAborted()
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

      if (isConcurrent) {
        results[index] = result
      } else {
        results.push(result)
      }

      onModelChecked?.(result, index)
      return result
    }

    if (isConcurrent) {
      await Promise.all(models.map(runModelCheck))
    } else {
      for (let index = 0; index < models.length; index++) {
        const model = models[index]
        if (!model) continue
        signal?.throwIfAborted()
        await runModelCheck(model, index)
      }
    }
  } catch (error) {
    logger.error('[ProviderSettings checkModelsHealth] Model health check failed:', error as Error)
    throw error
  }

  return results
}
