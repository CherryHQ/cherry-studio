import { getPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildAgentRightPaneStatus, buildAgentToolFlowProjection } from '../agentRightPaneProjection'

const message = (id: string, parts: CherryMessagePart[]): CherryUIMessage =>
  ({
    id,
    role: 'assistant',
    parts,
    metadata: {},
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z'
  }) as CherryUIMessage

const toolPart = (
  toolCallId: string,
  toolName: string,
  parentToolCallId?: string,
  state = 'output-available',
  input?: unknown,
  output?: unknown
): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    output,
    callProviderMetadata: {
      'claude-code': {
        parentToolCallId: parentToolCallId ?? null
      }
    }
  }) as unknown as CherryMessagePart

const textPart = (text: string, parentToolCallId?: string): CherryMessagePart =>
  ({
    type: 'text',
    text,
    providerMetadata: parentToolCallId
      ? {
          'claude-code': {
            parentToolCallId
          }
        }
      : undefined
  }) as unknown as CherryMessagePart

describe('agent right pane projections', () => {
  it('builds a selected tool subtree with text and reasoning parts owned by that subtree', () => {
    const parts = [
      toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Explore the repo' }, 'Done exploring'),
      textPart('child agent text', 'root'),
      toolPart('child', 'Read', 'root'),
      {
        type: 'reasoning',
        text: 'child reasoning',
        providerMetadata: {
          'claude-code': {
            parentToolCallId: 'child'
          }
        }
      } as unknown as CherryMessagePart,
      textPart('outside')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.selectedToolCallIds).toEqual(new Set(['root', 'child']))
    expect(projection.messages.map((item) => item.id)).toEqual(['root:agent-flow-prompt', 'root:agent-flow-assistant'])
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toHaveLength(4)
    expect(projection.partsByMessageId['root:agent-flow-assistant'][1]).not.toBe(parts[2])
    expect(getPartParentToolCallId(projection.partsByMessageId['root:agent-flow-assistant'][1])).toBeUndefined()
    expect(Object.values(projection.partsByMessageId).flat()).not.toContain(parts[0])
    expect(Object.values(projection.partsByMessageId).flat()).not.toContain(parts[4])
    expect((projection.partsByMessageId['root:agent-flow-prompt'][0] as { text?: string }).text).toBe(
      'Explore the repo'
    )
    expect((projection.partsByMessageId['root:agent-flow-assistant'][3] as { text?: string }).text).toBe(
      'Done exploring'
    )
  })

  it('degrades to the selected tool prompt when child metadata is missing', () => {
    const parts = [
      toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Run the subagent' }),
      textPart('unowned child text')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.messages.map((item) => item.id)).toEqual(['root:agent-flow-prompt'])
    expect((projection.partsByMessageId['root:agent-flow-prompt'][0] as { text?: string }).text).toBe(
      'Run the subagent'
    )
  })

  it('keeps the flow assistant pending while the selected tool subtree is streaming', () => {
    const parts = [toolPart('root', 'Agent', undefined, 'input-available', { prompt: 'Run the subagent' })]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')
    const assistant = projection.messages.find((item) => item.role === 'assistant')

    expect(assistant?.metadata?.status).toBe('pending')
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([])
  })

  it('includes live overlay parts that do not have a persisted message row yet', () => {
    const parts = [
      toolPart('root', 'Agent', undefined, 'input-available', { prompt: 'Run the subagent' }),
      toolPart('child', 'Read', 'root', 'input-streaming')
    ]

    const projection = buildAgentToolFlowProjection([], { live: parts }, 'root')

    expect(projection.selectedToolCallIds).toEqual(new Set(['root', 'child']))
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toHaveLength(1)
  })

  it('aggregates TodoWrite and TaskList into status tasks', () => {
    const parts = [
      toolPart('todos', 'TodoWrite', undefined, 'output-available', {
        todos: [
          { content: 'Design pane', activeForm: 'Designing pane', status: 'completed' },
          { content: 'Wire flow', activeForm: 'Wiring flow', status: 'in_progress' }
        ]
      }),
      toolPart(
        'task-list',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [{ id: 'task-1', subject: 'Review context', status: 'pending', blockedBy: [] }]
        }
      )
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks.map((task) => task.title)).toEqual(['Design pane', 'Wire flow', 'Review context'])
    expect(status.activeTask?.title).toBe('Wire flow')
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(3)
  })
})
