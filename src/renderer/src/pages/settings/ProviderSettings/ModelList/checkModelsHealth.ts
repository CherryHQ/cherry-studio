import { loggerService } from '@logger'
import { checkApi } from '@renderer/services/ApiService'
import { serializeHealthCheckError } from '@renderer/utils/error'

import type { ApiKeyWithStatus, ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults } from '../utils/healthCheck'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

export async function checkModelWithMultipleKeys(
  model: ModelCheckOptions['models'][number],
  apiKeys: string[],
  timeout?: number,
  signal?: AbortSignal
): Promise<ApiKeyWithStatus[]> {
  const checkPromises = apiKeys.map(async (key) => {
    signal?.throwIfAborted()
    const { latency } = await checkApi(model.id, { timeout, signal })

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
  const { models, apiKeys, isConcurrent, timeout, signal } = options
  const results: ModelWithStatus[] = []

  try {
    const runModelCheck = async (model: ModelCheckOptions['models'][number], index: number) => {
      signal?.throwIfAborted()
      const keyResults = await checkModelWithMultipleKeys(model, apiKeys, timeout, signal)
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
