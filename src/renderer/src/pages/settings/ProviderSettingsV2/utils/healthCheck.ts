import i18n from '@renderer/i18n'

import type { ApiKeyWithStatus, ModelWithStatus } from '../types/healthCheck'
import { HealthStatus } from '../types/healthCheck'

export function healthCheckErrorToDisplayString(error: ApiKeyWithStatus['error'] | string | undefined | null): string {
  if (error == null) {
    return ''
  }
  if (typeof error === 'string') {
    return error.trim()
  }
  const msg = error.message?.trim()
  if (msg) {
    return msg
  }
  const name = error.name?.trim()
  if (name) {
    return name
  }
  return ''
}

export function aggregateApiKeyResults(keyResults: ApiKeyWithStatus[]): {
  status: HealthStatus
  error?: string
  latency?: number
} {
  const successResults = keyResults.filter((result) => result.status === HealthStatus.SUCCESS)
  const failedResults = keyResults.filter((result) => result.status === HealthStatus.FAILED)

  if (failedResults.length > 0) {
    const errorStrings = failedResults
      .map((result) => healthCheckErrorToDisplayString(result.error))
      .filter((s) => s !== '')
    const errors = [...new Set(errorStrings)].join('; ')

    return {
      status: HealthStatus.FAILED,
      error: errors || undefined,
      latency: successResults.length > 0 ? Math.min(...successResults.map((result) => result.latency!)) : undefined
    }
  }

  return {
    status: HealthStatus.SUCCESS,
    latency: successResults.length > 0 ? Math.min(...successResults.map((result) => result.latency!)) : undefined
  }
}

export function summarizeHealthResults(results: ModelWithStatus[], providerName?: string): string {
  const t = i18n.t

  let successCount = 0
  let partialCount = 0
  let failedCount = 0

  for (const result of results) {
    if (result.status === HealthStatus.SUCCESS) {
      successCount++
    } else if (result.status === HealthStatus.FAILED) {
      const hasSuccessKey = result.keyResults.some((keyResult) => keyResult.status === HealthStatus.SUCCESS)
      if (hasSuccessKey) {
        partialCount++
      } else {
        failedCount++
      }
    }
  }

  const summaryParts: string[] = []
  if (successCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_passed', { count: successCount }))
  }
  if (partialCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_partial', { count: partialCount }))
  }
  if (failedCount > 0) {
    summaryParts.push(t('settings.models.check.model_status_failed', { count: failedCount }))
  }

  if (summaryParts.length === 0) {
    return t('settings.models.check.no_results')
  }

  const summary = summaryParts.join(', ')
  return t('settings.models.check.model_status_summary', {
    provider: providerName ?? 'Unknown Provider',
    summary
  })
}
