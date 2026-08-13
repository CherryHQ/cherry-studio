import { loggerService } from '@logger'
import { serializeHealthCheckError } from '@renderer/utils/error'

import type { ApiKeyWithStatus, ModelCheckCredential, ModelCheckOptions, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'
import { aggregateApiKeyResults, checkApi } from '../utils/healthCheck'

const logger = loggerService.withContext('ProviderSettings:checkModelsHealth')

export async function checkModelWithMultipleKeys(
  model: ModelCheckOptions['models'][number],
  credentials: ModelCheckCredential[],
  timeout?: number,
  signal?: AbortSignal
): Promise<ApiKeyWithStatus[]> {
  if (credentials.length === 0) return []

  return Promise.all(
    credentials.map(async (credential) => {
      signal?.throwIfAborted()
      try {
        const apiKey = credential.kind === 'api-key' ? credential.entry.key : undefined
        const { latency } = await checkApi(model.id, { apiKey, timeout, signal })
        return {
          kind: 'ok',
          credential,
          status: HealthStatus.SUCCESS,
          checking: false,
          latency
        } satisfies ApiKeyWithStatus
      } catch (error) {
        return {
          kind: 'failed',
          credential,
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
