import { loggerService } from '@logger'

import type { ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults, checkModelWithMultipleKeys } from '../utils/healthCheck'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelWithStatus, index: number) => void
): Promise<ModelWithStatus[]> {
  const { models, credentials, isConcurrent, timeout, signal } = options
  const results: ModelWithStatus[] = []

  try {
    const runModelCheck = async (model: ModelCheckOptions['models'][number], index: number) => {
      signal?.throwIfAborted()
      const keyResults = await checkModelWithMultipleKeys(model, credentials, timeout, signal)
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
