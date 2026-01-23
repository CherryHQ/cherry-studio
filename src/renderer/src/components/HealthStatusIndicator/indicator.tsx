import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { HealthStatus } from '@renderer/types/healthCheck'
import { Flex, Tooltip, Typography } from 'antd'
import React, { memo, useCallback } from 'react'
import styled from 'styled-components'

import type { HealthResult } from './types'
import { useHealthStatus } from './useHealthStatus'

interface HealthStatusIndicatorProps {
  results: HealthResult[]
  loading?: boolean
  showLatency?: boolean
  onErrorClick?: (result: HealthResult) => void
}

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
      <IndicatorWrapper $type="checking">
        <LoadingOutlined spin />
      </IndicatorWrapper>
    )
  }

  if (overallStatus === 'not_checked') return null

  const isClickable = onErrorClick && results.some((r) => r.status === HealthStatus.FAILED)

  let icon: React.ReactNode = null
  switch (overallStatus) {
    case 'success':
      icon = <CheckCircleFilled />
      break
    case 'error':
    case 'partial': {
      const IconComponent = overallStatus === 'error' ? CloseCircleFilled : ExclamationCircleFilled
      icon = <IconComponent />
      break
    }
    default:
      return null
  }

  return (
    <Flex align="center" gap={6}>
      {latencyText && <LatencyText type="secondary">{latencyText}</LatencyText>}
      <Tooltip title={tooltip} styles={{ body: { userSelect: 'text' } }}>
        <IndicatorWrapper
          $type={overallStatus}
          $clickable={isClickable}
          onClick={isClickable ? handleClick : undefined}>
          {icon}
        </IndicatorWrapper>
      </Tooltip>
    </Flex>
  )
}

const IndicatorWrapper = styled.div<{ $type: string; $clickable?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'auto')};
  color: ${({ $type }) => {
    switch ($type) {
      case 'success':
        return 'var(--color-status-success)'
      case 'error':
        return 'var(--color-status-error)'
      case 'partial':
        return 'var(--color-status-warning)'
      case 'checking':
      default:
        return 'var(--color-text)'
    }
  }};
`

const LatencyText = styled(Typography.Text)`
  margin-left: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
`

export default memo(HealthStatusIndicator)
