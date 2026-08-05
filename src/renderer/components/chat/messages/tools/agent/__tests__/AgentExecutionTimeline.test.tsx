import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

const cardProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined
}))

vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', () => ({
  usePartsMap: () => new Map()
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
})
