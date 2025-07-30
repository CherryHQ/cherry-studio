import React from 'react'
import styled from 'styled-components'

import PocMessageBubble from './PocMessageBubble'
import { PocMessage } from '../types'

const MessageContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  text-align: center;
`

interface PocMessageListProps {
  messages?: PocMessage[]
}

const PocMessageList: React.FC<PocMessageListProps> = ({ messages = [] }) => {
  if (messages.length === 0) {
    return (
      <MessageContainer>
        <EmptyState>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💻</div>
          <h3>Command POC Interface</h3>
          <p>Enter shell commands below to see them execute in real-time.</p>
          <p style={{ fontSize: '12px', opacity: 0.7 }}>
            Try commands like: <code>ls</code>, <code>pwd</code>, or <code>echo "Hello World"</code>
          </p>
        </EmptyState>
      </MessageContainer>
    )
  }

  return (
    <MessageContainer>
      {messages.map(message => (
        <PocMessageBubble key={message.id} message={message} />
      ))}
    </MessageContainer>
  )
}

export default PocMessageList