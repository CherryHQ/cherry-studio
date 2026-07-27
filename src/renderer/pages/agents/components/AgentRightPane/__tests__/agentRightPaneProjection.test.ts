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

    const nextProjection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')
    expect(nextProjection.partsByMessageId['root:agent-flow-assistant'][0]).toBe(
      projection.partsByMessageId['root:agent-flow-assistant'][0]
    )
    expect(nextProjection.partsByMessageId['root:agent-flow-assistant'][1]).toBe(
      projection.partsByMessageId['root:agent-flow-assistant'][1]
    )
  })

  it('uses a lazily resolved selected output and preserves child parts untouched', () => {
    const deferred = { $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'root' } }
    const selected = toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Explore the repo' }, deferred)
    const child = toolPart(
      'child',
      'Read',
      'root',
      'output-available',
      { file_path: '/tmp/example' },
      {
        $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'child' }
      }
    )
    const parts = [selected, child]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root', 'Loaded subagent summary')

    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([
      expect.objectContaining({ toolCallId: 'child' }),
      { type: 'text', text: 'Loaded subagent summary' }
    ])
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

  // SDK task events describe spawned processes, not the agent's own plan, so they populate
  // `runTasks` and stay out of the plan's done/total ratio.
  it('applies persisted Claude SDK task events to run tasks, not the plan', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'task-1',
          status: 'in_progress',
          title: 'Inspect task state',
          activeText: 'Inspecting task state',
          taskType: 'subagent',
          subagentType: 'code-reviewer'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          summary: 'Inspect task state',
          outputFile: '/tmp/task-1.md',
          usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([])
    expect(status.totalTaskCount).toBe(0)
    // Fields the old shared shape could not carry now survive the projection.
    expect(status.runTasks).toEqual([
      {
        id: 'task-1',
        title: 'Inspect task state',
        activeText: 'Inspecting task state',
        status: 'completed',
        taskType: 'subagent',
        subagentType: 'code-reviewer',
        workflowName: undefined,
        outputFile: '/tmp/task-1.md',
        usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
      }
    ])
  })

  it('projects declared artifacts into status', () => {
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

  // The completion can land as a part (wake turn) while the late-event cache still holds an earlier
  // in-progress event; the cache applies last, so without the guard every projection rebuild —
  // e.g. a renderer refresh — resurrected the settled row.
  it('never resurrects a settled task from a stale late event', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'Fetch latest', taskType: 'local_bash' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'bg-1', status: 'completed', summary: 'done' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'bg-1': { event: 'progress', taskId: 'bg-1', status: 'in_progress', description: 'Fetch latest' }
      }
    )

    expect(status.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'completed' })])
  })

  // A background task's completion arrives after its turn closed, so it never becomes a part.
  // Without merging it the row would stay running for the rest of the session.
  it('settles a run task from lifecycle that arrived after its turn closed', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'sleep 300', taskType: 'local_bash' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const running = buildAgentRightPaneStatus(messages, { m1: parts })
    expect(running.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'in_progress' })])

    const settled = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'bg-1': {
          event: 'notification',
          taskId: 'bg-1',
          status: 'completed',
          summary: 'slept',
          outputFile: '/tmp/bg-1.md'
        }
      }
    )

    // Merged by task id onto the part-derived row, keeping what only the parts knew.
    expect(settled.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        status: 'completed',
        taskType: 'local_bash',
        outputFile: '/tmp/bg-1.md'
      })
    ])
  })

  // Only the current CLI process's task edge stream can keep a row live. A session-wide active turn
  // must not resurrect historical rows, and the unrelated background-task level is aggregate only.
  it('does not resurrect a stale run task when an unrelated later task is active', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'agent-1', status: 'in_progress', title: 'Review', taskType: 'local_agent' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'progress', taskId: 'agent-1', status: 'in_progress', description: 'Reading files' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const live = buildAgentRightPaneStatus(messages, { m1: parts }, {}, { liveTaskIds: new Set(['agent-1']) })
    expect(live.runTasks).toEqual([expect.objectContaining({ id: 'agent-1', status: 'in_progress' })])

    const unrelatedActive = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'agent-2': {
          event: 'started',
          taskId: 'agent-2',
          status: 'in_progress',
          title: 'New review',
          taskType: 'local_agent'
        }
      },
      { liveTaskIds: new Set(['agent-2']) }
    )
    expect(unrelatedActive.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending' }),
      expect.objectContaining({ id: 'agent-2', status: 'in_progress' })
    ])

    const stale = buildAgentRightPaneStatus(messages, { m1: parts }, {}, { liveTaskIds: new Set() })
    expect(stale.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending', activeText: undefined })
    ])
  })
})
