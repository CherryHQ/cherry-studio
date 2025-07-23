import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Flex, Tooltip, Typography } from 'antd'
import React, { memo } from 'react'
import styled from 'styled-components'

import { HealthResult } from './types'
import { useHealthStatus } from './useHealthStatus'

export interface HealthStatusIndicatorProps {
  results: HealthResult[]
  loading?: boolean
  showLatency?: boolean
}

const HealthStatusIndicator: React.FC<HealthStatusIndicatorProps> = ({
  results,
  loading = false,
  showLatency = false
}) => {
  const { overallStatus, tooltip, latencyText } = useHealthStatus({
    results,
    showLatency
  })

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
      icon = <CloseCircleFilled />
      break
    case 'partial':
      icon = <ExclamationCircleFilled />
      break
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
