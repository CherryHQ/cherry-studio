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
  }
`

interface PocStatusBarProps {
  status?: 'idle' | 'running' | 'error'
  activeCommand?: string
  commandCount?: number
}

const PocStatusBar: React.FC<PocStatusBarProps> = ({ status = 'idle', activeCommand, commandCount = 0 }) => {
  const getStatusText = () => {
    switch (status) {
      case 'running':
        return activeCommand ? `Running: ${activeCommand}` : 'Running command...'
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
      </StatusLeft>
      <StatusRight>
        <div>Commands executed: {commandCount}</div>
      </StatusRight>
    </StatusContainer>
  )
}

export default PocStatusBar
