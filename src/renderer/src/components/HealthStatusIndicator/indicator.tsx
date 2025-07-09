import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Flex, Tooltip } from 'antd'
import React, { memo } from 'react'

import { IndicatorWrapper, LatencyText } from './styled'
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

export default memo(HealthStatusIndicator)
