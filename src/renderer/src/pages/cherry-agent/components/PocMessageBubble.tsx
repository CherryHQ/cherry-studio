import { PocMessage } from '@types'
import React from 'react'
import styled from 'styled-components'

const MessageContainer = styled.div<{ $isUser: boolean }>`
  display: flex;
  justify-content: ${(props) => (props.$isUser ? 'flex-end' : 'flex-start')};
  margin-bottom: 8px;
`

const BubbleBase = styled.div`
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.4;
`

const CommandBubble = styled(BubbleBase)`
  background: var(--color-primary);
  color: var(--color-primary-text);
  font-family: var(--font-mono);
`

const OutputBubble = styled(BubbleBase)<{ $isError?: boolean }>`
  background: ${(props) => (props.$isError ? 'rgba(239, 68, 68, 0.1)' : 'var(--color-background-soft)')};
  color: ${(props) => (props.$isError ? '#ef4444' : 'var(--color-text)')};
  border: 1px solid ${(props) => (props.$isError ? '#ef4444' : 'var(--color-border)')};
`

const CommandPrefix = styled.span`
  color: var(--color-primary-text);
  opacity: 0.8;
  margin-right: 8px;
`

const CommandText = styled.span`
  font-family: var(--font-mono);
`

const OutputPre = styled.pre`
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
`

const LoadingDots = styled.div`
  display: inline-block;
  margin-left: 8px;

  &::after {
    content: '...';
    animation: loading 1.5s infinite;
  }

  @keyframes loading {
    0%,
    20% {
      content: '.';
    }
    40% {
      content: '..';
    }
    60%,
    100% {
      content: '...';
    }
  }
`

interface PocMessageBubbleProps {
  message: PocMessage
}

const PocMessageBubble: React.FC<PocMessageBubbleProps> = ({ message }) => {
  const isUserCommand = message.type === 'user-command'
  const isError = message.type === 'error'

  return (
    <MessageContainer $isUser={isUserCommand}>
      {isUserCommand ? (
        <CommandBubble>
          <CommandPrefix>$</CommandPrefix>
          <CommandText>{message.content}</CommandText>
        </CommandBubble>
      ) : (
        <OutputBubble $isError={isError}>
          <OutputPre>{message.content}</OutputPre>
          {!message.isComplete && <LoadingDots />}
        </OutputBubble>
      )}
    </MessageContainer>
  )
}

export default PocMessageBubble
