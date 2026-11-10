import { loggerService } from '@logger'

import type { ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults, checkModelWithMultipleKeys } from '../utils/healthCheck'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

/**
 * Checks each model with every credential. `isConcurrent` runs models in parallel; keys for a
 * model always run in parallel. Each probe is bounded by `timeout` (main enforces it; default 15s),
 * so one hung provider cannot stall the run. Skipped models must be filtered out by the caller.
 */
export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelWithStatus, index: number) => void
): Promise<ModelWithStatus[]> {
  const { models, credentials, isConcurrent, timeout, signal } = options
  const results: ModelWithStatus[] = []
  const runStartedAt = performance.now()

  try {
    const runModelCheck = async (model: ModelCheckOptions['models'][number], index: number) => {
      signal?.throwIfAborted()
      const modelStartedAt = performance.now()
      const keyResults = await checkModelWithMultipleKeys(model, credentials, timeout, signal)
      signal?.throwIfAborted()
      const analysis = aggregateApiKeyResults(keyResults)
      logger.info('Model check finished', {
        modelId: model.id,
        status: analysis.status,
        durationMs: Math.round(performance.now() - modelStartedAt)
      })

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
    logger.info('Model check run finished', {
      modelCount: models.length,
      isConcurrent,
      durationMs: Math.round(performance.now() - runStartedAt)
    })
  } catch (error) {
    logger.error('[ProviderSettings checkModelsHealth] Model health check failed:', error as Error)
    throw error
  }

  return results
}
