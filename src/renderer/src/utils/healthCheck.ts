import i18n from '@renderer/i18n'
import { ApiKeyWithStatus, HealthStatus, ModelWithStatus } from '@renderer/types/healthCheck'

/**
 * 聚合多个 API 密钥检查结果，得到模型健康检查的整体状态
 */
export function aggregateApiKeyResults(keyResults: ApiKeyWithStatus[]): {
  status: HealthStatus
  error?: string
  latency?: number
} {
  const successResults = keyResults.filter((r) => r.status === HealthStatus.SUCCESS)
  const failedResults = keyResults.filter((r) => r.status === HealthStatus.FAILED)

  if (failedResults.length > 0) {
    // 只要有一个密钥失败，整个检查就失败
    const errors = failedResults
      .map((r) => r.error)
      .filter((v, i, a) => a.indexOf(v) === i) // 去重
      .join('; ')
    return {
      status: HealthStatus.FAILED,
      error: errors,
      latency: successResults.length > 0 ? Math.min(...successResults.map((r) => r.latency!)) : undefined
    }
  }

  // 所有密钥都成功
  return {
    status: HealthStatus.SUCCESS,
    latency: successResults.length > 0 ? Math.min(...successResults.map((r) => r.latency!)) : undefined
  }
}

/**
 * 将多个模型的健康检查结果汇总为字符串
 */
export function summarizeHealthResults(results: ModelWithStatus[], providerName?: string): string {
  const t = i18n.t

  let successCount = 0
  let partialCount = 0
  let failedCount = 0

  for (const result of results) {
    if (result.status === HealthStatus.SUCCESS) {
      successCount++
    } else if (result.status === HealthStatus.FAILED) {
      const hasSuccessKey = result.keyResults.some((r) => r.status === HealthStatus.SUCCESS)
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
