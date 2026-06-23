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

  it('ignores legacy TodoWrite and aggregates TaskList into status tasks', () => {
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

    expect(status.tasks.map((task) => task.title)).toEqual(['Review context'])
    expect(status.completedTaskCount).toBe(0)
    expect(status.totalTaskCount).toBe(1)
  })

  it('uses SDK task subject fields instead of ordinal ids', () => {
    const parts = [
      toolPart(
        'task-list',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [{ id: '1', subject: '构建瑞士风格 AI 产品发布 PPT', status: 'completed', blockedBy: [] }]
        }
      )
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([
      {
        id: '1',
        title: '构建瑞士风格 AI 产品发布 PPT',
        status: 'completed'
      }
    ])
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(1)
  })

  it('merges TaskUpdate into a pending TaskCreate by SDK ordinal id before create output arrives', () => {
    const parts = [
      toolPart('task-create', 'TaskCreate', undefined, 'input-available', {
        subject: '制作瑞士风格AI产品发布PPT',
        description: '基于瑞士国际主义风格制作发布 PPT',
        activeForm: '制作瑞士风格AI产品发布PPT'
      }),
      toolPart('task-update', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'in_progress',
        activeForm: '制作瑞士风格AI产品发布PPT'
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([
      {
        id: '1',
        title: '制作瑞士风格AI产品发布PPT',
        activeText: '制作瑞士风格AI产品发布PPT',
        status: 'in_progress'
      }
    ])
    expect(status.totalTaskCount).toBe(1)
  })

  it('applies persisted Claude SDK task events to status tasks', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'task-1',
          status: 'in_progress',
          title: 'Inspect task state',
          activeText: 'Inspecting task state'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          summary: 'Inspect task state'
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([
      {
        id: 'task-1',
        title: 'Inspect task state',
        activeText: 'Inspecting task state',
        status: 'completed'
      }
    ])
  })

  it('projects sub-agents and declared artifacts into status', () => {
    const parts = [
      toolPart('agent-1', 'Agent', undefined, 'input-available', { description: 'Inspect renderer state' }),
      toolPart('task-1', 'Task', undefined, 'output-error', { name: 'Audit tests' }),
      toolPart('artifacts-1', 'report_artifacts', undefined, 'output-available', {
        artifacts: [
          { path: 'docs/report.md', description: 'Summary report' },
          { path: 'docs/report.md', description: 'Updated summary report' },
          { path: '/tmp/build/output.json' }
        ],
        summary: 'Created deliverables'
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.subagents).toEqual([
      { toolCallId: 'agent-1', name: 'Inspect renderer state', status: 'running' },
      { toolCallId: 'task-1', name: 'Audit tests', status: 'error' }
    ])
    expect(status.artifacts).toEqual([
      {
        toolCallId: 'artifacts-1',
        path: 'docs/report.md',
        name: 'report.md',
        description: 'Updated summary report'
      },
      {
        toolCallId: 'artifacts-1',
        path: '/tmp/build/output.json',
        name: 'output.json',
        description: undefined
      }
    ])
  })
})
