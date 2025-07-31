import {
  ClearOutlined,
  CloseOutlined,
  FolderOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import { Button, Tooltip } from 'antd'
import React, { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

const InputContainer = styled.div<{ $status: 'idle' | 'running' | 'error' }>`
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border-top: 1px solid var(--color-border);
  transition: all 0.2s ease;

  ${(props) =>
    props.$status === 'running' &&
    `
    border-top-color: #22c55e;
    box-shadow: inset 0 1px 0 rgba(34, 197, 94, 0.1);
  `}

  ${(props) =>
    props.$status === 'error' &&
    `
    border-top-color: #ef4444;
    box-shadow: inset 0 1px 0 rgba(239, 68, 68, 0.1);
  `}
`

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: var(--color-background-soft);
  font-size: 11px;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
`

const StatusLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StatusRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StatusIndicator = styled.div<{ $status: 'idle' | 'running' | 'error' }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;

  &::before {
    content: '';
    width: 6px;
    height: 6px;
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
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`

const WorkingDirectory = styled.span`
  font-family: var(--font-mono);
  background: var(--color-background);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
`

const ActiveCommand = styled.span`
  font-family: var(--font-mono);
  background: var(--color-background);
  padding: 1px 4px;
  border-radius: 3px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const InputRow = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 8px;
`

const PromptPrefix = styled.div<{ $status: 'idle' | 'running' | 'error' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 14px;
  color: ${(props) => {
    switch (props.$status) {
      case 'running':
        return '#22c55e'
      case 'error':
        return '#ef4444'
      default:
        return 'var(--color-primary)'
    }
  }};
  font-weight: 600;
`

const InputWrapper = styled.div`
  flex: 1;
  position: relative;
`

const Input = styled.input<{ $status: 'idle' | 'running' | 'error' }>`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  font-family: var(--font-mono);
  background: var(--color-background-soft);
  color: var(--color-text);
  outline: none;
  transition: all 0.2s ease;

  &:focus {
    border-color: ${(props) => {
      switch (props.$status) {
        case 'running':
          return '#22c55e'
        case 'error':
          return '#ef4444'
        default:
          return 'var(--color-primary)'
      }
    }};
    box-shadow: 0 0 0 2px
      ${(props) => {
        switch (props.$status) {
          case 'running':
            return 'rgba(34, 197, 94, 0.1)'
          case 'error':
            return 'rgba(239, 68, 68, 0.1)'
          default:
            return 'var(--color-primary-alpha)'
        }
      }};
    background: var(--color-background);
  }

  &::placeholder {
    color: var(--color-text-secondary);
    font-family: var(--font-text);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ActionButton = styled(Button)`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text-secondary);
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: var(--color-background);
    color: var(--color-text);
    border-color: var(--color-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

const PrimaryActionButton = styled(ActionButton)<{ $variant: 'send' | 'cancel' }>`
  background: ${(props) => (props.$variant === 'cancel' ? '#ef4444' : 'var(--color-primary)')};
  color: white;
  border-color: transparent;
  width: 40px;

  &:hover:not(:disabled) {
    background: ${(props) => (props.$variant === 'cancel' ? '#dc2626' : 'var(--color-primary-hover)')};
    color: white;
  }
`

const QuickHint = styled.div`
  padding: 0 16px 8px 16px;
  font-size: 10px;
  color: var(--color-text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const HintLeft = styled.div`
  display: flex;
  gap: 12px;
`

const HintText = styled.span`
  opacity: 0.7;
`

interface EnhancedCommandInputProps {
  status?: 'idle' | 'running' | 'error'
  currentWorkingDirectory?: string
  activeCommand?: string
  commandCount?: number
  onSendCommand?: (command: string) => void
  onCancelCommand?: () => void
  onOpenSettings?: () => void
  disabled?: boolean
}

const EnhancedCommandInput: React.FC<EnhancedCommandInputProps> = ({
  status = 'idle',
  currentWorkingDirectory = '~',
  activeCommand,
  commandCount = 0,
  onSendCommand = () => {},
  onCancelCommand,
  onOpenSettings = () => {},
  disabled = false
}) => {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const history = useCommandHistory()

  const isRunning = status === 'running'
  const canSend = input.trim() && !disabled
  const canCancel = isRunning && onCancelCommand

  useEffect(() => {
    if (!isRunning && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isRunning])

  const handleSend = useCallback(() => {
    const trimmedInput = input.trim()
    if (trimmedInput && !disabled) {
      onSendCommand(trimmedInput)
      setInput('')
      history.resetNavigation()
    }
  }, [input, disabled, onSendCommand, history])

  const handleCancel = useCallback(() => {
    if (canCancel) {
      onCancelCommand()
    }
  }, [canCancel, onCancelCommand])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (canCancel) {
          handleCancel()
        } else {
          handleSend()
        }
      } else if (e.key === 'Escape' && canCancel) {
        e.preventDefault()
        handleCancel()
      } else {
        const navigationResult = history.handleKeyNavigation(e.nativeEvent, input)
        if (navigationResult !== null) {
          setInput(navigationResult)
        }
      }
    },
    [handleSend, handleCancel, canCancel, history, input]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setInput(newValue)

      if (!history.isNavigating) {
        history.resetNavigation()
      }
    },
    [history]
  )

  const getStatusText = () => {
    switch (status) {
      case 'running':
        return 'Executing'
      case 'error':
        return 'Error'
      default:
        return 'Ready'
    }
  }

  const getPromptSymbol = () => {
    switch (status) {
      case 'running':
        return '⚡'
      case 'error':
        return '✗'
      default:
        return '$'
    }
  }

  return (
    <InputContainer $status={status}>
      <StatusRow>
        <StatusLeft>
          <StatusIndicator $status={status}>{getStatusText()}</StatusIndicator>
          <WorkingDirectory>
            <FolderOutlined style={{ fontSize: 10, marginRight: 2 }} />
            {currentWorkingDirectory}
          </WorkingDirectory>
          {isRunning && activeCommand && <ActiveCommand title={activeCommand}>Running: {activeCommand}</ActiveCommand>}
        </StatusLeft>
        <StatusRight>
          <span>Commands: {commandCount}</span>
        </StatusRight>
      </StatusRow>

      <InputRow>
        <PromptPrefix $status={status}>{getPromptSymbol()}</PromptPrefix>

        <InputWrapper>
          <Input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Press Enter or Esc to cancel...' : 'Enter shell command...'}
            disabled={disabled}
            $status={status}
          />
        </InputWrapper>

        <ActionButtons>
          <Tooltip title="Command history">
            <ActionButton
              icon={<HistoryOutlined />}
              disabled={disabled}
              onClick={() => {
                // Could open history modal or cycle through history
                const lastCommand = history.navigatePrevious(input)
                if (lastCommand) setInput(lastCommand)
              }}
            />
          </Tooltip>

          <Tooltip title="Clear input">
            <ActionButton icon={<ClearOutlined />} disabled={disabled || !input} onClick={() => setInput('')} />
          </Tooltip>

          <Tooltip title="Settings">
            <ActionButton icon={<SettingOutlined />} onClick={onOpenSettings} />
          </Tooltip>

          {canCancel ? (
            <Tooltip title="Cancel command (Enter/Esc)">
              <PrimaryActionButton $variant="cancel" icon={<CloseOutlined />} onClick={handleCancel} />
            </Tooltip>
          ) : (
            <Tooltip title="Execute command (Enter)">
              <PrimaryActionButton
                $variant="send"
                icon={<PlayCircleOutlined />}
                disabled={!canSend}
                onClick={handleSend}
              />
            </Tooltip>
          )}
        </ActionButtons>
      </InputRow>

      <QuickHint>
        <HintLeft>
          <HintText>↑/↓ History</HintText>
          <HintText>Enter Execute</HintText>
          {canCancel && <HintText>Esc Cancel</HintText>}
        </HintLeft>
        <HintText>{isRunning ? 'Command running...' : 'Ready for input'}</HintText>
      </QuickHint>
    </InputContainer>
  )
}

export default EnhancedCommandInput
