import { act, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { Topic } from '@renderer/types/topic'

vi.unmock('@data/hooks/useDataApi')
vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Left: 'left', Right: 'right' } }))
vi.mock('@renderer/components/chat/messages/frame/MessageMenuBar', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: ({ message }: { message: { stats?: { contextTokens?: number } } }) => (
    <div>Context tokens: {message.stats?.contextTokens ?? 'unknown'}</div>
  )
}))

import TopicMessageFlowNode from '../TopicMessageFlowNode'

const service = dataApiService as typeof dataApiService & {
  _resetMockState: () => void
  _emitDataChange: (effects: Array<{ endpoint: '/messages/:id'; entityIds: string[] }>) => void
}

beforeEach(() => service._resetMockState())

it('refreshes a saved message card after its ancestor deletion changes context', async () => {
  let stats: { contextTokens?: number } = { contextTokens: 42 }
  vi.mocked(dataApiService.get).mockImplementation(
    async () =>
      ({
        id: 'follow',
        topicId: 'topic',
        parentId: 'reply',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Follow-up' }] },
        status: 'success',
        siblingsGroupId: 0,
        stats,
        createdAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-08T00:00:00Z'
      }) as never
  )
  const props = {
    id: 'follow',
    data: {
      messageId: 'follow',
      preview: 'Follow-up',
      role: 'assistant',
      status: 'success',
      createdAt: '2026-09-08T00:00:00Z',
      isActive: true,
      isOnActivePath: true,
      isInactiveBranch: false
    }
  } as ComponentProps<typeof TopicMessageFlowNode>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MessageContentProvider messages={[]} partsByMessageId={{}} topic={{ id: 'topic' } as Topic}>
        <TopicMessageFlowNode {...props} />
      </MessageContentProvider>
    </SWRConfig>
  )
  await screen.findByText('Context tokens: 42')
  stats = {}
  await act(async () => service._emitDataChange([{ endpoint: '/messages/:id', entityIds: ['unrelated'] }]))
  expect(screen.getByText('Context tokens: 42')).toBeInTheDocument()
  await act(async () => service._emitDataChange([{ endpoint: '/messages/:id', entityIds: ['reply', 'follow'] }]))
  await waitFor(() => expect(screen.getByText('Context tokens: unknown')).toBeInTheDocument())
})
