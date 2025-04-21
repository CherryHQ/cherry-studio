import i18n from '@renderer/i18n'
import { Model, Provider } from '@renderer/types'

import { checkModel } from './ModelService'

/**
 * Model check status states
 */
export enum ModelCheckStatus {
  NOT_CHECKED = 'not_checked',
  SUCCESS = 'success',
  FAILED = 'failed',
  PARTIAL = 'partial' // Some API keys worked, some failed
}

/**
 * Options for model health check
 */
export interface ModelCheckOptions {
  provider: Provider
  models: Model[]
  apiKeys: string[]
  isConcurrent: boolean
}

/**
 * Single API key check status
 */
export interface ApiKeyCheckStatus {
  key: string
  isValid: boolean
  error?: string
  latency?: number // Check latency in milliseconds
}

/**
 * Result of a model health check
 */
export interface ModelCheckResult {
  model: Model
  keyResults: ApiKeyCheckStatus[]
  latency?: number // Smallest latency of all successful checks
  status?: ModelCheckStatus
  error?: string
}

/**
 * Analyzes model check results to determine overall status
 */
export function analyzeModelCheckResult(result: ModelCheckResult): {
  status: ModelCheckStatus
  error?: string
  latency?: number
} {
  const validKeyCount = result.keyResults.filter((r) => r.isValid).length
  const totalKeyCount = result.keyResults.length

  if (validKeyCount === totalKeyCount) {
    return {
      status: ModelCheckStatus.SUCCESS,
      latency: result.latency
    }
  } else if (validKeyCount === 0) {
    // All keys failed
    const errors = result.keyResults
      .filter((r) => r.error)
      .map((r) => r.error)
      .filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates

    return {
      status: ModelCheckStatus.FAILED,
      error: errors.join('; ')
    }
  } else {
    // Partial success
    return {
      status: ModelCheckStatus.PARTIAL,
      latency: result.latency,
      error: i18n.t('settings.models.check.keys_status_count', {
        count_passed: validKeyCount,
        count_failed: totalKeyCount - validKeyCount
      })
    }
  }
}

/**
 * Checks a model with multiple API keys
 */
export async function checkModelWithMultipleKeys(
  provider: Provider,
  model: Model,
  apiKeys: string[],
  isParallel: boolean
): Promise<Omit<ModelCheckResult, 'model' | 'status' | 'error'>> {
  let keyResults: ApiKeyCheckStatus[] = []

  if (isParallel) {
    // Check all API keys in parallel
    const keyPromises = apiKeys.map(async (key) => {
      const result = await checkModel({ ...provider, apiKey: key }, model)

      return {
        key,
        isValid: result.valid,
        error: result.error?.message,
        latency: result.latency
      } as ApiKeyCheckStatus
    })

    const results = await Promise.allSettled(keyPromises)

    // Process results
    keyResults = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        return {
          key: 'unknown', // This should not happen since we've caught errors internally
          isValid: false,
          error: 'Promise rejection: ' + result.reason
        }
      }
    })
  } else {
    // Check all API keys serially
    for (const key of apiKeys) {
      const result = await checkModel({ ...provider, apiKey: key }, model)

      keyResults.push({
        key,
        isValid: result.valid,
        error: result.error?.message,
        latency: result.latency
      })
    }
  }

  // Calculate fastest successful response time
  const successResults = keyResults.filter((r) => r.isValid && r.latency !== undefined)
  const latency = successResults.length > 0 ? Math.min(...successResults.map((r) => r.latency!)) : undefined

  return { keyResults, latency }
}

/**
 * Performs health checks for multiple models
 */
export async function checkModelsHealth(
  options: ModelCheckOptions,
  onModelChecked?: (result: ModelCheckResult, index: number) => void
): Promise<ModelCheckResult[]> {
  const { provider, models, apiKeys, isConcurrent } = options

  // Results array
  const results: ModelCheckResult[] = []

  try {
    if (isConcurrent) {
      // Check all models concurrently
      const modelPromises = models.map(async (model, index) => {
        const checkResult = await checkModelWithMultipleKeys(provider, model, apiKeys, true)
        const analysisResult = analyzeModelCheckResult({
          model,
          ...checkResult,
          status: undefined,
          error: undefined
        })

        const result: ModelCheckResult = {
          model,
          ...checkResult,
          status: analysisResult.status,
          error: analysisResult.error
        }

        results[index] = result

        if (onModelChecked) {
          onModelChecked(result, index)
        }

        return result
      })

      await Promise.allSettled(modelPromises)
    } else {
      // Check all models serially
      for (let i = 0; i < models.length; i++) {
        const model = models[i]
        const checkResult = await checkModelWithMultipleKeys(provider, model, apiKeys, false)

        const analysisResult = analyzeModelCheckResult({
          model,
          ...checkResult,
          status: undefined,
          error: undefined
        })

        const result: ModelCheckResult = {
          model,
          ...checkResult,
          status: analysisResult.status,
          error: analysisResult.error
        }

        results.push(result)

        if (onModelChecked) {
          onModelChecked(result, i)
        }
      }
    }
  } catch (error) {
    console.error('Model health check failed:', error)
  }

  return results
}
