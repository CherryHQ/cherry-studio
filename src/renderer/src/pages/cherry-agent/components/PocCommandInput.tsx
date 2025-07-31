import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import React, { KeyboardEvent, useCallback, useState } from 'react'
import styled from 'styled-components'

const InputContainer = styled.div`
  display: flex;
  padding: 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background);
  gap: 12px;
  align-items: flex-end;
`

const InputWrapper = styled.div`
  flex: 1;
  position: relative;
`

const Input = styled.input`
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  font-family: var(--font-mono);
  background: var(--color-background-soft);
  color: var(--color-text);
  outline: none;

  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  &::placeholder {
    color: var(--color-text-secondary);
    font-family: var(--font-text);
  }
`

const SendButton = styled.button`
  padding: 12px 20px;
  background: var(--color-primary);
  color: var(--color-primary-text);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

const Hint = styled.div`
  position: absolute;
  bottom: -20px;
  left: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
`

interface PocCommandInputProps {
  onSendCommand?: (command: string) => void
  disabled?: boolean
  commandHistory?: ReturnType<typeof useCommandHistory>
}

const PocCommandInput: React.FC<PocCommandInputProps> = ({ onSendCommand = () => {}, disabled = false }) => {
  const [input, setInput] = useState('')

  // Use the provided command history or create a default one
  const history = useCommandHistory()

  const handleSend = useCallback(() => {
    const trimmedInput = input.trim()
    if (trimmedInput && !disabled) {
      onSendCommand(trimmedInput)
      setInput('')
      // Reset navigation when sending command
      history.resetNavigation()
    }
  }, [input, disabled, onSendCommand, history])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      } else {
        // Handle history navigation
        const navigationResult = history.handleKeyNavigation(e.nativeEvent, input)
        if (navigationResult !== null) {
          setInput(navigationResult)
        }
      }
    },
    [handleSend, history, input]
  )

  // Handle input changes - reset navigation when user types
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setInput(newValue)

      // Reset navigation if user starts typing and is not navigating
      if (!history.isNavigating) {
        history.resetNavigation()
      }
    },
    [history]
  )

  return (
    <InputContainer>
      <InputWrapper>
        <Hint>Enter shell commands (e.g., ls, pwd, echo "hello") • Use ↑/↓ for history</Hint>
        <Input
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a shell command..."
          disabled={disabled}
        />
      </InputWrapper>
      <SendButton onClick={handleSend} disabled={disabled || !input.trim()}>
        Send
      </SendButton>
    </InputContainer>
  )
}

export default PocCommandInput
