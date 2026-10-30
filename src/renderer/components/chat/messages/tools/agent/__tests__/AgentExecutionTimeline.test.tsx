import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagePartsScopeProvider, PartsProvider } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

const cardProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined
}))

vi.mock('../AgentToolCallCard', () => ({
  AgentToolCallCard: (props: Record<string, unknown>) => {
    cardProps.current = props
    return <div data-testid="agent-tool-card" />
  }
}))

import { AgentExecutionTimeline } from '../AgentExecutionTimeline'

function toolResponse(name: 'Agent' | 'Task', response: unknown): NormalToolResponse {
  return {
    id: `response-${name}`,
    toolCallId: `tool-${name}`,
    tool: { name },
    arguments: { description: 'Inspect the workspace' },
    response,
    status: 'done'
  } as unknown as NormalToolResponse
}

describe('AgentExecutionTimeline', () => {
  beforeEach(() => {
    cardProps.current = undefined
  })

  it('passes an async Agent launch receipt to the collapsed card', () => {
    const receipt = { status: 'async_launched', taskId: 'task-1' }

    render(<AgentExecutionTimeline toolResponse={toolResponse('Agent', receipt)} />)

    expect(cardProps.current).toMatchObject({
      output: receipt,
      openFlowOnClick: true,
      showInlineDetails: false
    })
  })

  it('passes completed Task statistics to the collapsed card', () => {
    const receipt = {
      status: 'completed',
      totalTokens: 1200,
      totalToolUseCount: 4,
      totalDurationMs: 9000
    }

    render(<AgentExecutionTimeline toolResponse={toolResponse('Task', receipt)} />)

    expect(cardProps.current).toMatchObject({
      output: receipt,
      openFlowOnClick: true,
      showInlineDetails: false
    })
  })

  it('keeps a launched background Agent running while its in-scope task is in progress', () => {
    const taskEvent = {
      type: 'data-agent-task-event',
      data: { event: 'progress', taskId: 'task-1', toolUseId: 'tool-Agent', status: 'in_progress' }
    } as CherryMessagePart

    render(
      <PartsProvider value={{ 'message-1': [taskEvent], 'message-2': [] }}>
        <MessagePartsScopeProvider messageId="message-1" parts={[taskEvent]}>
          <AgentExecutionTimeline
            toolResponse={toolResponse('Agent', { status: 'async_launched', taskId: 'task-1' })}
          />
        </MessagePartsScopeProvider>
      </PartsProvider>
    )

    expect(cardProps.current).toMatchObject({ status: 'invoking', isStreaming: true })
  })

  it.each([
    ['completed', 'done'],
    ['error', 'error'],
    ['stopped', 'cancelled']
  ] as const)(
    'settles a background Agent when a steer moved its %s event to the continuation',
    (taskStatus, cardStatus) => {
      const launched = {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'task-1', toolUseId: 'tool-Agent', status: 'in_progress' }
      } as CherryMessagePart
      const settled = {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'task-1', status: taskStatus }
      } as CherryMessagePart

      render(
        <PartsProvider value={{ 'message-1': [launched], 'continuation-1': [settled] }}>
          <MessagePartsScopeProvider messageId="message-1" parts={[launched]}>
            <AgentExecutionTimeline
              toolResponse={toolResponse('Agent', { status: 'async_launched', taskId: 'task-1' })}
            />
          </MessagePartsScopeProvider>
        </PartsProvider>
      )

      expect(cardProps.current).toMatchObject({ status: cardStatus, isStreaming: false })
    }
  )

  it('only enables Session cards for the Cherry tools server', () => {
    const response = toolResponse('Task', { ok: true, sessionId: 'not-a-cherry-session' })
    response.tool = { id: 'session_create', name: 'session_create', type: 'mcp', serverId: 'tmux' } as never

    const { rerender } = render(<AgentExecutionTimeline toolResponse={response} />)
    expect(cardProps.current).toMatchObject({ isCherrySessionTool: false })

    response.tool = { ...response.tool, serverId: 'cherry-tools' } as never
    rerender(<AgentExecutionTimeline toolResponse={response} />)
    expect(cardProps.current).toMatchObject({ isCherrySessionTool: true })
  })
})
