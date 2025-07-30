import React, { useState, useCallback, KeyboardEvent } from 'react'
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
  top: -20px;
  left: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
`

interface PocCommandInputProps {
  onSendCommand?: (command: string) => void
  disabled?: boolean
}

const PocCommandInput: React.FC<PocCommandInputProps> = ({ 
  onSendCommand = () => {}, 
  disabled = false 
}) => {
  const [input, setInput] = useState('')

  const handleSend = useCallback(() => {
    const trimmedInput = input.trim()
    if (trimmedInput && !disabled) {
      onSendCommand(trimmedInput)
      setInput('')
    }
  }, [input, disabled, onSendCommand])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    // TODO: Add arrow key history navigation
  }, [handleSend])

  return (
    <InputContainer>
      <InputWrapper>
        <Hint>Enter shell commands (e.g., ls, pwd, echo "hello")</Hint>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
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