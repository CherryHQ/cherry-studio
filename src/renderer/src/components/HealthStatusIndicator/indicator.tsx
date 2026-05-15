import { Flex, Tooltip } from '@cherrystudio/ui'
import { HealthStatus } from '@renderer/types/healthCheck'
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import React, { memo, useCallback } from 'react'

import type { HealthResult } from './types'
import { useHealthStatus } from './useHealthStatus'

interface HealthStatusIndicatorProps {
  results: HealthResult[]
  loading?: boolean
  showLatency?: boolean
  onErrorClick?: (result: HealthResult) => void
}

const STATUS_COLOR = {
  success: 'var(--color-success-base)',
  error: 'var(--color-error-base)',
  partial: 'var(--color-warning-base)',
  checking: 'var(--color-foreground)'
} as const

const HealthStatusIndicator: React.FC<HealthStatusIndicatorProps> = ({
  results,
  loading = false,
  showLatency = false,
  onErrorClick
}) => {
  const { overallStatus, tooltip, latencyText } = useHealthStatus({
    results,
    showLatency
  })

  const handleClick = useCallback(() => {
    if (!onErrorClick) return
    const failedResult = results.find((r) => r.status === HealthStatus.FAILED)
    if (failedResult) {
      onErrorClick(failedResult)
    }
  }, [onErrorClick, results])

  if (loading) {
    return (
      <div className="flex items-center justify-center text-sm" style={{ color: STATUS_COLOR.checking }}>
        <LoaderCircle size={14} className="animate-spin" />
      </div>
    )
  }

  if (overallStatus === 'not_checked') return null

  const isClickable = onErrorClick && results.some((r) => r.status === HealthStatus.FAILED)

  let icon: React.ReactNode = null
  switch (overallStatus) {
    case 'success':
      icon = <CircleCheck size={14} />
      break
    case 'error':
      icon = <CircleX size={14} />
      break
    case 'partial': {
      icon = <CircleAlert size={14} />
      break
    }
    default:
      return null
  }

  return (
    <Flex className="items-center gap-1.5">
      {latencyText && <span className="ml-2.5 text-[12px] text-foreground-secondary">{latencyText}</span>}
      <Tooltip content={tooltip} className="select-text">
        <div
          className="flex items-center justify-center text-sm"
          style={{
            color: STATUS_COLOR[overallStatus],
            cursor: isClickable ? 'pointer' : 'auto'
          }}
          onClick={isClickable ? handleClick : undefined}>
          {icon}
        </div>
      </Tooltip>
    </Flex>
  )
}

export default memo(HealthStatusIndicator)
