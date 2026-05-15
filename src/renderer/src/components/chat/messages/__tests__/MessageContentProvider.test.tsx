import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import MessageContent from '../frame/MessageContent'
import { MessageContentProvider } from '../MessageContentProvider'
import { useMessageListActions } from '../MessageListProvider'
import type { MessageListItem } from '../types'

describe('MessageContentProvider', () => {
  const message: MessageListItem = {
    id: 'message-1',
    role: 'assistant',
    topicId: 'standalone-topic',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success'
  }
  const partsByMessageId: Record<string, CherryMessagePart[]> = {
    [message.id]: [{ type: 'text', text: 'standalone content' }]
  }

  it('provides the minimal message contexts for standalone content rendering', () => {
    render(
      <MessageContentProvider messages={[message]} partsByMessageId={partsByMessageId}>
        <MessageContent message={message} />
      </MessageContentProvider>
    )

    expect(screen.getByText('standalone content')).toBeInTheDocument()
  })

  it('provides default platform actions for standalone content rendering', () => {
    const Probe = () => {
      const actions = useMessageListActions()
      return <span>{actions.copyText && actions.notifyError ? 'platform-actions' : 'missing-actions'}</span>
    }

    render(
      <MessageContentProvider messages={[message]} partsByMessageId={partsByMessageId}>
        <Probe />
      </MessageContentProvider>
    )

    expect(screen.getByText('platform-actions')).toBeInTheDocument()
  })
})
