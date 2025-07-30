import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'

import { PocMessage } from '../types'
import PocMessageBubble from './PocMessageBubble'

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
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScrollRef.current && messageContainerRef.current) {
      const container = messageContainerRef.current
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  // Handle scroll to detect if user has scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (messageContainerRef.current) {
      const container = messageContainerRef.current
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50
      shouldAutoScrollRef.current = isAtBottom
    }
  }

  if (messages.length === 0) {
    return (
      <MessageContainer ref={messageContainerRef} onScroll={handleScroll}>
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
    <MessageContainer ref={messageContainerRef} onScroll={handleScroll}>
      {messages.map((message) => (
        <PocMessageBubble key={message.id} message={message} />
      ))}
    </MessageContainer>
  )
}

export default PocMessageList
