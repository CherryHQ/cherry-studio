import { loggerService } from '@logger'
import { serializeHealthCheckError } from '@renderer/utils/error'

import type { ApiKeyWithStatus, ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults, checkApi } from '../utils/healthCheck'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

export async function checkModelWithMultipleKeys(
  model: ModelCheckOptions['models'][number],
  apiKeys: string[],
  timeout?: number,
  signal?: AbortSignal
): Promise<ApiKeyWithStatus[]> {
  if (apiKeys.length === 0) return []

  return Promise.all(
    apiKeys.map(async (key) => {
      signal?.throwIfAborted()
      try {
        const { latency } = await checkApi(model.id, { apiKey: key, timeout, signal })
        return { kind: 'ok', key, status: HealthStatus.SUCCESS, checking: false, latency } satisfies ApiKeyWithStatus
      } catch (error) {
        return {
          kind: 'failed',
          key,
          status: HealthStatus.FAILED,
          checking: false,
          error: serializeHealthCheckError(error)
        } satisfies ApiKeyWithStatus
      }
    })
  )
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
