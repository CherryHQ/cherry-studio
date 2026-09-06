import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cardProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined
}))

vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', () => ({
  usePartsMap: () => new Map(),
  useAgentLaunchIndex: () => null
}))

vi.mock('../AgentToolCallCard', () => ({
  AgentToolCallCard: (props: Record<string, unknown>) => {
    cardProps.current = props
    return <div data-testid="agent-tool-card" />
  },
  getAgentToolFlowTitle: () => undefined
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
