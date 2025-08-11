import { HealthStatus } from '@renderer/types/healthCheck'
import { Flex } from 'antd'
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
  const tooltip = (
    <ul
      style={{
        maxHeight: '300px',
        overflowY: 'auto',
        margin: 0,
        padding: 0,
        listStyleType: 'none',
        maxWidth: '300px',
        wordWrap: 'break-word'
      }}>
      {results.map((result, idx) => {
        const statusText = getStatusText(result.status)
        const statusColor =
          result.status === HealthStatus.SUCCESS ? 'var(--color-status-success)' : 'var(--color-status-error)'

        return (
          <li key={idx} style={{ marginBottom: idx === results.length - 1 ? 0 : '10px' }}>
            <Flex align="center" justify="space-between">
              <strong style={{ color: statusColor }}>{statusText}</strong>
              {result.label}
            </Flex>
            {result.latency && result.status === HealthStatus.SUCCESS && (
              <div style={{ marginTop: 2 }}>
                {t('settings.provider.api.key.check.latency')}: {formatLatency(result.latency)}
              </div>
            )}
            {result.error && result.status === HealthStatus.FAILED && (
              <div style={{ marginTop: 2 }}>{result.error}</div>
            )}
          </li>
        )
      })}
    </ul>
  )

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
