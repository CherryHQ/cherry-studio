import { CloseOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import React from 'react'
import styled from 'styled-components'

const StatusContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--color-background-soft);
  border-top: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-secondary);
  min-height: 32px;
`

const StatusLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const StatusRight = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const StatusIndicator = styled.div<{ $status: 'idle' | 'running' | 'error' }>`
  display: flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${(props) => {
      switch (props.$status) {
        case 'running':
          return '#22c55e'
        case 'error':
          return '#ef4444'
        default:
          return '#6b7280'
      }
    }};
    ${(props) =>
      props.$status === 'running' &&
      `
      animation: pulse 1.5s infinite;
    `}
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
    100% {
      opacity: 1;
    }
  }
`

const CancelButton = styled(Button)`
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
`

const CommandText = styled.span`
  font-family: var(--font-mono);
  background: var(--color-background);
  padding: 2px 6px;
  border-radius: 4px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

interface PocStatusBarProps {
  status?: 'idle' | 'running' | 'error'
  activeCommand?: string
  commandCount?: number
  onCancelCommand?: () => void
}

const PocStatusBar: React.FC<PocStatusBarProps> = ({ 
  status = 'idle', 
  activeCommand, 
  commandCount = 0, 
  onCancelCommand 
}) => {
  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'Running:'
      case 'error':
        return 'Command failed'
      default:
        return 'Ready'
    }
  }

  return (
    <StatusContainer>
      <StatusLeft>
        <StatusIndicator $status={status}>{getStatusText()}</StatusIndicator>
        {status === 'running' && activeCommand && (
          <CommandText title={activeCommand}>{activeCommand}</CommandText>
        )}
      </StatusLeft>
      <StatusRight>
        {status === 'running' && onCancelCommand && (
          <CancelButton 
            type="text" 
            size="small" 
            danger
            icon={<CloseOutlined />}
            onClick={onCancelCommand}
            title="Cancel running command"
          >
            Cancel
          </CancelButton>
        )}
        <div>Commands executed: {commandCount}</div>
      </StatusRight>
    </StatusContainer>
  )
}

export default PocStatusBar
