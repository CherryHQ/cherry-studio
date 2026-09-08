import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { MessageListActions, MessageListItem } from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, Message } from '@shared/data/types/message'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowNode from '../TopicMessageFlowNode'
import type { TopicMessageFlowNodeData } from '../types'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' }
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', async () => {
  const { useMessageParts } = await import('@renderer/components/chat/messages/blocks/MessagePartsContext')
  return {
    default: function MessageContent({ message }: { message: MessageListItem }) {
      return (
        <p>
          {useMessageParts(message.id)
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('')}
        </p>
      )
    }
  }
})

vi.mock('@renderer/components/chat/messages/frame/MessageMenuBar', async () => {
  const { useMessageListActions } = await import('@renderer/components/chat/messages/MessageListProvider')
  return {
    default: function MessageMenuBar({
      message,
      onStartEditing
    }: {
      message: MessageListItem
      onStartEditing: () => void
    }) {
      const actions = useMessageListActions()
      return (
        <>
          <button type="button" onClick={onStartEditing}>
            Edit message
          </button>
          <button type="button" onClick={() => actions.regenerateMessage?.(message.id)}>
            Retry message
          </button>
        </>
      )
    }
  }
})

const nodeData: TopicMessageFlowNodeData = {
  createdAt: '2026-01-01T00:01:00.000Z',
  isActive: false,
  isInactiveBranch: false,
  isOnActivePath: true,
  messageId: 'message-1',
  preview: 'Truncated preview',
  role: 'assistant',
  status: 'success'
}

const message: Message = {
  id: 'message-1',
  topicId: 'topic-1',
  parentId: 'user-1',
  role: 'assistant',
  data: { parts: [{ type: 'text', text: 'Complete response including the final paragraph.' }] },
  searchableText: '',
  status: 'success',
  siblingsGroupId: 0,
  modelId: null,
  messageSnapshot: null,
  stats: null,
  createdAt: nodeData.createdAt,
  updatedAt: nodeData.createdAt
}

function NodeFixture({
  data = nodeData,
  actions = {},
  partsByMessageId = {},
  onSelect = () => {}
}: {
  data?: TopicMessageFlowNodeData
  actions?: MessageListActions
  partsByMessageId?: Record<string, CherryMessagePart[]>
  onSelect?: () => void
}) {
  const props = { data, id: data.messageId, selected: false } as ComponentProps<typeof TopicMessageFlowNode>
  return (
    <MessageContentProvider
      messages={[]}
      partsByMessageId={partsByMessageId}
      topic={{ id: 'topic-1' } as Topic}
      actions={actions}>
      <div onClick={onSelect}>
        <TopicMessageFlowNode {...props} />
      </div>
    </MessageContentProvider>
  )
}

describe('TopicMessageFlowNode', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en-us')
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/messages/:id', message)
  })

  it('shows the complete saved response immediately on an inactive branch', () => {
    render(<NodeFixture data={{ ...nodeData, isOnActivePath: false, isInactiveBranch: true }} />)
    expect(screen.getByText('Complete response including the final paragraph.')).toBeVisible()
    expect(screen.queryByText('Truncated preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeVisible()
  })

  it('uses live parts instead of the persisted response while streaming', () => {
    const { rerender } = render(
      <NodeFixture partsByMessageId={{ 'message-1': [{ type: 'text', text: 'First streamed chunk' }] }} />
    )
    expect(screen.getByText('First streamed chunk')).toBeVisible()
    rerender(<NodeFixture partsByMessageId={{ 'message-1': [{ type: 'text', text: 'Latest streamed content' }] }} />)
    expect(screen.getByText('Latest streamed content')).toBeVisible()
    expect(screen.queryByText('First streamed chunk')).not.toBeInTheDocument()
    expect(screen.queryByText('Complete response including the final paragraph.')).not.toBeInTheDocument()
  })

  it('lets the user resume an empty branch and renders its content after sending', async () => {
    const user = userEvent.setup()
    let selected = false
    const { rerender } = render(
      <NodeFixture
        data={{
          ...nodeData,
          role: 'user',
          isAwaitingInput: true
        }}
        onSelect={() => {
          selected = true
        }}
      />
    )
    await user.click(screen.getByText('Awaiting input'))
    expect(selected).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument()

    MockUseDataApiUtils.mockQueryData('/messages/:id', {
      ...message,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Continue this branch' }] }
    })
    rerender(<NodeFixture data={{ ...nodeData, role: 'user', isAwaitingInput: false }} />)
    expect(screen.getByText('Continue this branch')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeVisible()
  })

  it('blocks duplicate continuation requests while the first operation is pending', async () => {
    const user = userEvent.setup()
    const reserved: string[] = []
    const data = {
      ...nodeData,
      onStartBranch: (id: string) => {
        reserved.push(id)
      }
    }
    const { rerender } = render(<NodeFixture data={{ ...data, actionsDisabled: true }} />)
    await user.click(screen.getByRole('button', { name: 'Continue from here' }))
    expect(reserved).toEqual([])
    rerender(<NodeFixture data={{ ...data, actionsDisabled: false }} />)
    await user.click(screen.getByRole('button', { name: 'Continue from here' }))
    expect(reserved).toEqual(['message-1'])
  })

  it('selects a branch from its message body while keeping message actions separate', async () => {
    const user = userEvent.setup()
    let selected = false
    let retried: string | undefined
    let edited: { id: string; parts: CherryMessagePart[] } | undefined
    render(
      <NodeFixture
        onSelect={() => {
          selected = true
        }}
        actions={{
          regenerateMessage: (id) => {
            retried = id
          },
          startEditing: (item, parts) => {
            edited = { id: item.id, parts }
          }
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Edit message' }))
    await user.click(screen.getByRole('button', { name: 'Retry message' }))
    expect(edited).toEqual({ id: 'message-1', parts: message.data.parts })
    expect(retried).toBe('message-1')
    expect(selected).toBe(false)

    await user.click(screen.getByText('Complete response including the final paragraph.'))
    expect(selected).toBe(true)
  })

  it('keeps a failed body load visible without offering actions on missing content', () => {
    MockUseDataApiUtils.mockQueryError('/messages/:id', new Error('unavailable'))
    render(<NodeFixture />)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument()
  })

  it('shows the producing assistant avatar, name and full model name from the saved message', () => {
    MockUseDataApiUtils.mockQueryData('/messages/:id', {
      ...message,
      messageSnapshot: {
        id: 'assistant-1',
        name: 'Travel planner',
        emoji: '🌍',
        model: { id: 'qwen-3', name: 'Qwen 3 Thinking', provider: 'provider-1' }
      }
    })
    render(<NodeFixture />)
    expect(screen.getByText('Travel planner')).toBeVisible()
    expect(screen.getByText('Qwen 3 Thinking')).toBeVisible()
    expect(screen.getAllByText('🌍').some((element) => element.closest('.message-avatar'))).toBe(true)
  })

  it('does not label user messages with the model that generated their responses', () => {
    MockUseDataApiUtils.mockQueryData('/messages/:id', {
      ...message,
      role: 'user',
      modelId: 'provider-1:qwen-3'
    })
    render(<NodeFixture data={{ ...nodeData, role: 'user', modelId: 'provider-1:qwen-3' }} />)
    expect(screen.queryByText(/qwen/)).not.toBeInTheDocument()
  })
})
