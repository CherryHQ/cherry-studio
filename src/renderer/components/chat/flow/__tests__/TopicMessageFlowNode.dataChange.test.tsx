import { dataApiService } from '@data/DataApiService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, expect, it, vi } from 'vitest'

vi.unmock('@data/hooks/useDataApi')
vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Bottom: 'bottom', Top: 'top' } }))
vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const Context = React.createContext(false)
  return {
    Popover: ({ children, open }: { children: ReactNode; open: boolean }) => <Context value={open}>{children}</Context>,
    PopoverAnchor: ({ children }: { children: ReactNode }) => children,
    PopoverContent: ({ children }: { children: ReactNode }) => (React.use(Context) ? <div>{children}</div> : null)
  }
})
vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: ReactNode }) => children
}))
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

it('refreshes an open by-ID preview after its ancestor deletion changes context', async () => {
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
      <TopicMessageFlowNode {...props} />
    </SWRConfig>
  )
  fireEvent.mouseEnter(screen.getByText('Follow-up').closest('[data-message-id]')!)
  await screen.findByText('Context tokens: 42')
  stats = {}
  await act(async () => service._emitDataChange([{ endpoint: '/messages/:id', entityIds: ['unrelated'] }]))
  expect(screen.getByText('Context tokens: 42')).toBeInTheDocument()
  await act(async () => service._emitDataChange([{ endpoint: '/messages/:id', entityIds: ['reply', 'follow'] }]))
  await waitFor(() => expect(screen.getByText('Context tokens: unknown')).toBeInTheDocument())
})
