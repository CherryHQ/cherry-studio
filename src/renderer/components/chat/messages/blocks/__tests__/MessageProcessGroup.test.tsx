import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageProcessGroup from '../MessageProcessGroup'

const navigateToRoute = vi.hoisted(() => vi.fn())

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'message.processing') return 'Processing...'
      if (key === 'message.tools.placeholder.elapsed.seconds') return `${options?.seconds ?? '0'} seconds`
      return key
    }
  })
}))

vi.mock('../ToolBlockGroup', () => ({
  ToolBlockGroupHeaderContent: ({
    elapsedText,
    items,
    semanticToolTitle,
    summary
  }: {
    elapsedText?: string
    items: Array<{ toolResponse: { tool: { name: string }; arguments?: Record<string, unknown> } }>
    semanticToolTitle?: boolean
    summary?: string
  }) => (
    <div data-testid="process-header" data-semantic-tool-title={semanticToolTitle || undefined}>
      {summary} {elapsedText}
      {items.map((item) => `${item.toolResponse.tool.name}:${String(item.toolResponse.arguments?.title ?? '')}`)}
    </div>
  )
}))

describe('MessageProcessGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    navigateToRoute.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates only the active header while elapsed time advances', () => {
    const renderHistory = vi.fn(() => <div>Process history</div>)
    const message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'pending'
    } as MessageListItem

    render(
      <MessageProcessGroup phase="active" message={message} toolItems={[]}>
        {renderHistory}
      </MessageProcessGroup>
    )

    expect(renderHistory).toHaveBeenCalledOnce()
    expect(screen.getByTestId('process-header')).toHaveTextContent('0 seconds')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByTestId('process-header')).toHaveTextContent('3 seconds')
    expect(renderHistory).toHaveBeenCalledOnce()
  })

  it('excludes overlapping approval waits from the completed processing time', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'success',
      stats: {
        runtimeTiming: {
          startedAt: 1_000,
          completedAt: 11_000,
          spans: [
            {
              id: 'approval:approval-1',
              kind: 'approval-wait',
              approvalId: 'approval-1',
              toolCallId: 'tool-1',
              startedAt: 2_000,
              completedAt: 6_000
            },
            {
              id: 'approval:approval-2',
              kind: 'approval-wait',
              approvalId: 'approval-2',
              toolCallId: 'tool-2',
              startedAt: 4_000,
              completedAt: 8_000
            }
          ]
        }
      }
    } as MessageListItem

    render(
      <MessageProcessGroup phase="completed" outcome="success" message={message} toolItems={[]}>
        {() => <div>Process history</div>}
      </MessageProcessGroup>
    )

    expect(screen.getByTestId('process-header')).toHaveTextContent('4 seconds')
  })

  it('surfaces the latest session transfer in the collapsed completed header', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'success'
    } as MessageListItem
    const toolItems = [
      {
        id: 'tool-1',
        toolResponse: {
          id: 'tool-1',
          toolCallId: 'tool-1',
          tool: { id: 'tool-1', name: 'session_create', type: 'builtin' },
          arguments: { title: 'A very long session title' },
          status: 'done',
          response: { content: [{ type: 'text', text: '{"ok":true,"sessionId":"session-new"}' }] }
        }
      }
    ] as ToolRenderItem[]

    render(
      <MessageProcessGroup phase="completed" outcome="success" message={message} toolItems={toolItems}>
        {() => <div>Process history</div>}
      </MessageProcessGroup>
    )

    expect(screen.getByTestId('process-header')).toHaveAttribute('data-semantic-tool-title', 'true')
    expect(screen.getByTestId('process-header')).toHaveTextContent('session_create:A very long session title')
    expect(screen.queryByTestId('tool-history-content')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'message.tools.sessionCreate.open: A very long session title' }))
    expect(navigateToRoute).toHaveBeenCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-new' }
    })
  })
})
