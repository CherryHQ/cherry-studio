import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageContent from '../frame/MessageContent'
import { MessageContentProvider } from '../MessageContentProvider'
import { useMessageListActions, useMessageListItemActivityState } from '../MessageListProvider'
import type { MessageListItem } from '../types'

const streamStatus = vi.hoisted(() => ({
  status: 'awaiting-approval' as const,
  activeExecutions: [] as Array<{ anchorMessageId: string }>,
  awaitingApprovalAnchors: [{ anchorMessageId: 'message-1' }]
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => streamStatus
}))

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

  it('does not inject platform actions by default', () => {
    const Probe = () => {
      const actions = useMessageListActions()
      return <span>{actions.copyText && actions.notifyError ? 'platform-actions' : 'missing-actions'}</span>
    }

    render(
      <MessageContentProvider messages={[message]} partsByMessageId={partsByMessageId}>
        <Probe />
      </MessageContentProvider>
    )

    expect(screen.getByText('missing-actions')).toBeInTheDocument()
  })

  it('provides explicitly passed actions for standalone content rendering', () => {
    const Probe = () => {
      const actions = useMessageListActions()
      return <span>{actions.copyText && actions.notifyError ? 'platform-actions' : 'missing-actions'}</span>
    }

    render(
      <MessageContentProvider
        messages={[message]}
        partsByMessageId={partsByMessageId}
        actions={{
          copyText: async () => {},
          notifyError: () => {}
        }}>
        <Probe />
      </MessageContentProvider>
    )

    expect(screen.getByText('platform-actions')).toBeInTheDocument()
  })

  it('preserves approval-waiting activity for standalone content', () => {
    const Probe = () => {
      const activity = useMessageListItemActivityState(message)
      return <span>{`${activity.isProcessing}:${activity.isApprovalAnchor}:${activity.isActiveTurnProcessing}`}</span>
    }

    render(
      <MessageContentProvider messages={[message]} partsByMessageId={partsByMessageId}>
        <Probe />
      </MessageContentProvider>
    )

    expect(screen.getByText('true:true:true')).toBeInTheDocument()
  })
})
