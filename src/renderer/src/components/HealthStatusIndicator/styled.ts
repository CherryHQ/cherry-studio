import { Typography } from 'antd'
import styled from 'styled-components'

export const IndicatorWrapper = styled.div<{ $type: string }>`
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

export const LatencyText = styled(Typography.Text)`
  margin-left: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
`
