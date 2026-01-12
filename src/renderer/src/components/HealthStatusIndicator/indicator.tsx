import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { HealthStatus } from '@renderer/types/healthCheck'
import { Flex, Tooltip, Typography } from 'antd'
import React, { memo } from 'react'
import styled from 'styled-components'

import type { HealthStatusIndicatorProps } from './types'
import { useHealthStatus } from './useHealthStatus'

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

  const handleErrorClick = () => {
    if (!onErrorClick) return
    const failedResult = results.find((r) => r.status === HealthStatus.FAILED)
    if (failedResult?.error) {
      onErrorClick(failedResult.error)
    }
  }

  if (loading) {
    return (
      <IndicatorWrapper $type="checking">
        <LoadingOutlined spin />
      </IndicatorWrapper>
    )
  }

  if (overallStatus === 'not_checked') return null

  let icon: React.ReactNode = null
  switch (overallStatus) {
    case 'success':
      icon = <CheckCircleFilled />
      break
    case 'error':
    case 'partial': {
      const isClickable = onErrorClick && results.some((r) => r.status === HealthStatus.FAILED)
      const IconComponent = overallStatus === 'error' ? CloseCircleFilled : ExclamationCircleFilled
      icon = (
        <span onClick={isClickable ? handleErrorClick : undefined} style={{ cursor: isClickable ? 'pointer' : 'auto' }}>
          <IconComponent />
        </span>
      )
      break
    }
    default:
      return null
  }

  return (
    <Flex align="center" gap={6}>
      {latencyText && <LatencyText type="secondary">{latencyText}</LatencyText>}
      <Tooltip title={tooltip} styles={{ body: { userSelect: 'text' } }}>
        <IndicatorWrapper $type={overallStatus}>{icon}</IndicatorWrapper>
      </Tooltip>
    </Flex>
  )
}

const IndicatorWrapper = styled.div<{ $type: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: ${(props) => {
    switch (props.$type) {
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
