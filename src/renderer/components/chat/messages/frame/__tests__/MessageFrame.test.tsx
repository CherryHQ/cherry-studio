import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import MessageFrame from '../MessageFrame'

const originalLanguage = i18n.language
beforeAll(() => i18n.changeLanguage('en-US'))
afterAll(() => i18n.changeLanguage(originalLanguage))

const message: MessageListItem = {
  id: 'compact-message',
  topicId: 'topic-1',
  role: 'assistant',
  status: 'success',
  createdAt: '2026-11-09T00:00:00.000Z',
  messageSnapshot: {
    id: 'agent-1',
    name: 'Test Agent',
    model: { id: 'test-model', name: 'Test Model', provider: 'test-provider' }
  }
}
const compaction: CherryMessagePart = {
  type: 'data-compaction-anchor',
  data: { status: 'done', phase: 'agent-session' }
}

function frame(parts: CherryMessagePart[], row = message) {
  const value: MessageListProviderValue = {
    state: {
      topic: {
        id: 'topic-1',
        name: 'Test',
        assistantId: undefined,
        lastActivityAt: row.createdAt,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        messages: []
      },
      messages: [row],
      partsByMessageId: { [row.id]: parts },
      renderConfig: defaultMessageRenderConfig,
      messageNavigation: 'none',
      estimateSize: 100,
      overscan: 1,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0
    },
    actions: {},
    meta: { selectionLayer: false }
  }
  return (
    <MessageListProvider value={value}>
      <MessageFrame message={row} messageParts={parts} isLatestAssistantMessage />
    </MessageListProvider>
  )
}

describe('MessageFrame compaction presentation', () => {
  it('shows a standalone compaction without an assistant identity or message actions', () => {
    render(frame([compaction]))
    expect(screen.getByRole('separator')).toHaveTextContent('Context compacted')
    expect(screen.queryByText('Test Agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('updates the standalone status when compaction completes', () => {
    const { rerender } = render(
      frame([{ type: 'data-compaction-anchor', data: { status: 'compacting', phase: 'agent-session' } }])
    )
    expect(screen.getByRole('status')).toHaveTextContent('Compacting context')
    expect(screen.queryByText('Test Agent')).not.toBeInTheDocument()
    rerender(frame([compaction]))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('separator')).toHaveTextContent('Context compacted')
  })

  it('keeps the assistant frame when compaction shares a message with an answer', () => {
    render(frame([compaction, { type: 'text', text: 'The answer after compaction.' }]))
    expect(screen.getByText('Test Agent')).toBeInTheDocument()
    expect(screen.getByText('The answer after compaction.')).toBeInTheDocument()
  })

  it('keeps an empty pending message in the assistant frame', () => {
    render(frame([], { ...message, status: 'pending' }))
    expect(screen.getByText('Test Agent')).toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it.each([{ parts: [] }, { parts: [{ type: 'text', text: '' }, { type: 'step-start' }] }] satisfies {
    parts: CherryMessagePart[]
  }[])('shows an interrupted empty message without an assistant identity or actions (%j)', ({ parts }) => {
    render(frame(parts, { ...message, status: 'paused' }))
    expect(screen.getByRole('separator')).toHaveTextContent('Interrupted')
    expect(screen.queryByText('Chat completion paused')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Agent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('preserves the assistant frame and partial answer after interruption', () => {
    render(frame([{ type: 'text', text: 'A partial answer.' }], { ...message, status: 'paused' }))
    expect(screen.getByText('Test Agent')).toBeInTheDocument()
    expect(screen.getByText('A partial answer.')).toBeInTheDocument()
    expect(screen.queryByText('Chat completion paused')).not.toBeInTheDocument()
  })
})
