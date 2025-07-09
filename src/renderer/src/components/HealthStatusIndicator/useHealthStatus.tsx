import { HealthStatus } from '@renderer/types/healthCheck'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { HealthResult } from './types'

interface UseHealthStatusProps {
  results: HealthResult[]
  showLatency?: boolean
}

interface UseHealthStatusReturn {
  overallStatus: 'success' | 'error' | 'partial' | 'not_checked'
  latencyText: string | null
  tooltip: React.ReactNode | null
}

/**
 * Format check time to a human-readable string
 */
function formatLatency(time: number): string {
  return `${(time / 1000).toFixed(2)}s`
}

export const useHealthStatus = ({ results, showLatency = false }: UseHealthStatusProps): UseHealthStatusReturn => {
  const { t } = useTranslation()

  if (!results || results.length === 0) {
    return { overallStatus: 'not_checked', tooltip: null, latencyText: null }
  }

  const numSuccess = results.filter((r) => r.status === HealthStatus.SUCCESS).length
  const numFailed = results.filter((r) => r.status === HealthStatus.FAILED).length

  let overallStatus: 'success' | 'error' | 'partial' | 'not_checked' = 'not_checked'
  if (numSuccess > 0 && numFailed === 0) {
    overallStatus = 'success'
  } else if (numSuccess === 0 && numFailed > 0) {
    overallStatus = 'error'
  } else if (numSuccess > 0 && numFailed > 0) {
    overallStatus = 'partial'
  }

  // Don't render anything if not checked yet
  if (overallStatus === 'not_checked') {
    return { overallStatus, tooltip: null, latencyText: null }
  }

  const getStatusText = (s: HealthStatus) => {
    switch (s) {
      case HealthStatus.SUCCESS:
        return t('settings.models.check.passed')
      case HealthStatus.FAILED:
        return t('settings.models.check.failed')
      default:
        return ''
    }
  }

  // Generate Tooltip
  let tooltip: React.ReactNode
  if (results.length === 1) {
    const result = results[0]
    const statusTitle = getStatusText(result.status)
    const statusColor =
      result.status === HealthStatus.SUCCESS ? 'var(--color-status-success)' : 'var(--color-status-error)'
    tooltip = (
      <div
        style={{
          maxHeight: '200px',
          overflowY: 'auto',
          maxWidth: '300px',
          wordWrap: 'break-word'
        }}>
        <strong style={{ color: statusColor }}>{statusTitle}</strong>
        {result.label && <div style={{ marginTop: 5 }}>{result.label}</div>}
        {result.latency && result.status === HealthStatus.SUCCESS && (
          <div style={{ marginTop: 5 }}>
            {t('settings.provider.api.key.check.latency')}: {formatLatency(result.latency)}
          </div>
        )}
        {result.error && <div style={{ marginTop: 5 }}>{result.error}</div>}
      </div>
    )
  } else {
    tooltip = (
      <div>
        <div style={{ marginTop: 5 }}>
          <ul
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
              margin: 0,
              padding: 0,
              listStyleType: 'none'
            }}>
            {results.map((kr, idx) => {
              const statusText = getStatusText(kr.status)
              return (
                <li
                  key={idx}
                  style={{
                    marginBottom: '5px',
                    color:
                      kr.status === HealthStatus.SUCCESS ? 'var(--color-status-success)' : 'var(--color-status-error)'
                  }}>
                  {kr.label}: {statusText}
                  {kr.error && kr.status === HealthStatus.FAILED && ` (${kr.error})`}
                  {kr.latency && kr.status === HealthStatus.SUCCESS && ` (${formatLatency(kr.latency)})`}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  // Calculate latency
  let latencyText: string | null = null
  if (showLatency && overallStatus !== 'error') {
    const latencies = results.filter((r) => r.status === HealthStatus.SUCCESS && r.latency).map((r) => r.latency!)
    if (latencies.length > 0) {
      const minLatency = Math.min(...latencies)
      latencyText = formatLatency(minLatency)
    }
  }

  return { overallStatus, tooltip, latencyText }
}
