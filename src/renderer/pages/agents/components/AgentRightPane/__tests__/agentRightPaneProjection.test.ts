import { getPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type { AgentWorkflowSnapshot } from '@shared/ai/agentWorkflowProgress'
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

// A dsh-runtime tool part: runtime-native lowercase name plus the cherry transport tag its
// stream adapter stamps — the tag is what lets the projection resolve the canonical tool name.
const dshToolPart = (toolCallId: string, toolName: string, state: string, input?: unknown): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    callProviderMetadata: {
      cherry: { transport: 'dsh-agent', tool: { type: 'builtin', name: toolName } }
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

  it('separates an async launch receipt from the visible agent reply', () => {
    const launchReceipt =
      'Async agent launched successfully. (This tool result is internal metadata — never quote it.) agentId: internal-1 output_file: C:\\temp\\agent.output'
    const parts = [
      toolPart('root', 'Agent', undefined, 'output-available', { prompt: 'Inspect the renderer' }, launchReceipt),
      textPart('Child agent is inspecting the renderer.', 'root')
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.launchReceipt).toBe(launchReceipt)
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([
      expect.objectContaining({ type: 'text', text: 'Child agent is inspecting the renderer.' })
    ])
  })

  it('keeps a normal final agent summary in the visible reply', () => {
    const parts = [
      toolPart(
        'root',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Inspect the renderer' },
        'Inspection complete'
      )
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.launchReceipt).toBeUndefined()
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toContainEqual({
      type: 'text',
      text: 'Inspection complete'
    })
  })

  it('separates a foreground completion receipt from the visible agent reply', () => {
    const agentReceipt =
      "agentId: af624763698eaaff3 (use SendMessage with to: 'af624763698eaaff3', summary: '<5-10 word recap>' to continue this agent)"
    const usageReceipt = 'subagent_tokens: 27371\ntool_uses: 16\nduration_ms: 56581'
    const completionReceipt = `${agentReceipt}\n${usageReceipt}`
    const parts = [
      toolPart(
        'root',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Inspect the renderer' },
        `Inspection complete\n\n${agentReceipt}\n<usage>${usageReceipt}</usage>`
      )
    ]
    const messages = [message('m1', parts)]

    const projection = buildAgentToolFlowProjection(messages, { m1: parts }, 'root')

    expect(projection.completionReceipt).toBe(completionReceipt)
    expect(projection.partsByMessageId['root:agent-flow-assistant']).toContainEqual({
      type: 'text',
      text: 'Inspection complete'
    })
    expect(JSON.stringify(projection.partsByMessageId['root:agent-flow-assistant'])).not.toContain('<usage>')
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

  // TodoWrite snapshots and the task ledger both describe the same plan, so the most
  // recently written source owns the status list.
  it('lets the most recent plan writer win between TodoWrite snapshots and the task ledger', () => {
    const snapshotThenLedger = [
      toolPart('todos-1', 'TodoWrite', undefined, 'output-available', {
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

    const ledgerWins = buildAgentRightPaneStatus([message('m1', snapshotThenLedger)], { m1: snapshotThenLedger })
    expect(ledgerWins.tasks.map((task) => task.title)).toEqual(['Review context'])
    expect(ledgerWins.completedTaskCount).toBe(0)
    expect(ledgerWins.totalTaskCount).toBe(1)

    const ledgerThenSnapshot = [
      ...snapshotThenLedger,
      toolPart('todos-2', 'TodoWrite', undefined, 'output-available', {
        todos: [{ content: 'Polish the pane', activeForm: 'Polishing the pane', status: 'in_progress' }]
      })
    ]

    const snapshotWins = buildAgentRightPaneStatus([message('m1', ledgerThenSnapshot)], { m1: ledgerThenSnapshot })
    expect(snapshotWins.tasks.map((task) => task.title)).toEqual(['Polish the pane'])
    expect(snapshotWins.totalTaskCount).toBe(1)
  })

  it('projects the latest successful dsh todo_write snapshot into status tasks', () => {
    const parts = [
      dshToolPart('dsh-todos-1', 'todo_write', 'output-available', {
        todos: [
          { content: 'Inspect the runtime', status: 'completed' },
          { content: 'Wire the status pane', status: 'in_progress' }
        ]
      }),
      dshToolPart('dsh-todos-failed', 'todo_write', 'output-error', {
        todos: [{ content: 'Do not show this failed snapshot', status: 'in_progress' }]
      }),
      dshToolPart('dsh-todos-2', 'todo_write', 'output-available', {
        todos: [
          { content: 'Wire the status pane', status: 'completed' },
          { content: 'Verify the projection', status: 'pending' }
        ]
      })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks.map(({ title, status }) => ({ title, status }))).toEqual([
      {
        title: 'Wire the status pane',
        status: 'completed'
      },
      {
        title: 'Verify the projection',
        status: 'pending'
      }
    ])
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(2)
  })

  it('clears dsh status tasks when todo_write succeeds with an empty snapshot', () => {
    const parts = [
      dshToolPart('dsh-todos-1', 'todo_write', 'output-available', {
        todos: [{ content: 'Temporary task', status: 'completed' }]
      }),
      dshToolPart('dsh-todos-2', 'todo_write', 'output-available', { todos: [] })
    ]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([])
    expect(status.completedTaskCount).toBe(0)
    expect(status.totalTaskCount).toBe(0)
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

  it('keeps a session-wide TaskList scoped when loaded history starts at the current plan', () => {
    const parts = [
      toolPart(
        'create-current',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the current task' },
        'Task #11 created successfully: Start the current task'
      ),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the unloaded old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the current task', status: 'pending', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m2', parts)]

    const status = buildAgentRightPaneStatus(messages, { m2: parts })

    expect(status.tasks).toEqual([
      expect.objectContaining({ id: '11', title: 'Start the current task', status: 'pending' })
    ])
  })

  it('starts a new task plan when a later turn creates tasks after the previous plan completed', () => {
    const completedParts = [
      toolPart('create-old', 'TaskCreate', undefined, 'input-available', { subject: 'Finish the old task' }),
      toolPart('complete-old-1', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'completed'
      })
    ]
    const newParts = [
      toolPart(
        'create-new',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the new task' },
        'Task #11 created successfully: Start the new task'
      ),
      toolPart('complete-new', 'TaskUpdate', undefined, 'output-available', {
        taskId: '11',
        status: 'completed'
      }),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the new task', status: 'completed', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m1', completedParts), message('m2', newParts)]

    const status = buildAgentRightPaneStatus(messages, { m1: completedParts, m2: newParts })

    expect(status.tasks).toHaveLength(1)
    expect(status.tasks[0]).toMatchObject({ id: '11', title: 'Start the new task', status: 'completed' })
    expect(status.completedTaskCount).toBe(1)
    expect(status.totalTaskCount).toBe(1)
  })

  it('starts a new task plan after the previous plan completes earlier in the same assistant message', () => {
    const oldParts = [
      toolPart(
        'create-old',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Finish the old task' },
        'Task #1 created successfully: Finish the old task'
      )
    ]
    const transitionParts = [
      toolPart('complete-old', 'TaskUpdate', undefined, 'output-available', {
        taskId: '1',
        status: 'completed'
      }),
      toolPart(
        'create-new',
        'TaskCreate',
        undefined,
        'output-available',
        { subject: 'Start the new task' },
        'Task #11 created successfully: Start the new task'
      ),
      toolPart(
        'list-all',
        'TaskList',
        undefined,
        'output-available',
        {},
        {
          tasks: [
            { id: '1', subject: 'Finish the old task', status: 'completed', blockedBy: [] },
            { id: '11', subject: 'Start the new task', status: 'pending', blockedBy: [] }
          ]
        }
      )
    ]
    const messages = [message('m1', oldParts), message('m2', transitionParts)]

    const status = buildAgentRightPaneStatus(messages, { m1: oldParts, m2: transitionParts })

    expect(status.tasks).toEqual([
      expect.objectContaining({ id: '11', title: 'Start the new task', status: 'pending' })
    ])
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
          toolUseId: 'tool-use-1',
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
          event: 'progress',
          taskId: 'task-1',
          status: 'in_progress',
          title: 'Inspecting task state',
          activeText: 'Reading renderer state',
          summary: 'Reviewing renderer files',
          usage: { totalTokens: 800, toolUses: 3, durationMs: 6000 }
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          summary: 'Inspect task state',
          usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(messages, { m1: parts })

    expect(status.tasks).toEqual([])
    expect(status.totalTaskCount).toBe(0)
    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        toolUseId: 'tool-use-1',
        title: 'Inspect task state',
        activeText: 'Reading renderer state',
        status: 'completed',
        taskType: 'subagent',
        subagentType: 'code-reviewer',
        summary: 'Inspect task state',
        usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
      })
    ])
  })

  it('projects aggregate-only background tasks as running placeholders', () => {
    const status = buildAgentRightPaneStatus(
      [],
      {},
      {},
      [
        {
          id: 'aggregate-only',
          type: 'local_bash',
          description: 'pnpm dev',
          toolCallId: 'bash-1'
        }
      ],
      { activeMessageIds: new Set() }
    )

    expect(status.runTasks).toEqual([
      {
        id: 'aggregate-only',
        toolUseId: 'bash-1',
        title: 'pnpm dev',
        status: 'in_progress',
        taskType: 'local_bash',
        isBackgrounded: true
      }
    ])
  })

  it('lets a terminal lifecycle edge settle an aggregate-only placeholder', () => {
    const status = buildAgentRightPaneStatus(
      [],
      {},
      {
        'aggregate-only': {
          event: 'notification',
          taskId: 'aggregate-only',
          status: 'completed',
          completedAt: '2026-08-12T01:05:00.000Z'
        }
      },
      [{ id: 'aggregate-only', type: 'local_bash', description: 'pnpm dev', toolCallId: 'bash-1' }]
    )

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'aggregate-only',
        toolUseId: 'bash-1',
        title: 'pnpm dev',
        status: 'completed',
        completedAt: '2026-08-12T01:05:00.000Z',
        taskType: 'local_bash'
      })
    ])
  })

  it('uses aggregate membership as the only liveness authority for detached tasks', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'detached-1',
          status: 'in_progress',
          title: 'Detached task',
          taskType: 'subagent',
          isBackgrounded: true
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]
    const liveness = { activeMessageIds: new Set(['m1']) }

    const live = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      [{ id: 'detached-1', type: 'subagent', description: 'Detached task' }],
      liveness
    )
    expect(live.runTasks).toEqual([expect.objectContaining({ id: 'detached-1', status: 'in_progress' })])

    const removed = buildAgentRightPaneStatus(messages, { m1: parts }, {}, [], liveness)
    expect(removed.runTasks).toEqual([
      expect.objectContaining({ id: 'detached-1', status: 'error', activeText: undefined })
    ])
  })

  it('projects declared artifacts into status', () => {
    const parts = [
      toolPart('agent-1', 'Agent', undefined, 'input-available', { description: 'Inspect renderer state' }),
      toolPart('task-1', 'Task', undefined, 'output-error', { name: 'Audit tests' }),
      toolPart('artifacts-1', 'mcp__cherry-tools__report_artifacts', undefined, 'output-available', {
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
        data: {
          event: 'started',
          taskId: 'bg-1',
          status: 'in_progress',
          title: 'Fetch latest',
          activeText: 'Starting fetch',
          taskType: 'local_bash'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'progress',
          taskId: 'bg-1',
          status: 'in_progress',
          activeText: 'Fetching final page',
          summary: 'Almost done',
          usage: { totalTokens: 180, toolUses: 2, durationMs: 4000 }
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'bg-1',
          status: 'completed',
          completedAt: '2026-08-12T01:05:00.000Z',
          summary: 'Fetched every page',
          usage: { totalTokens: 200, toolUses: 3, durationMs: 5000 }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const status = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {
        'bg-1': {
          event: 'progress',
          taskId: 'bg-1',
          status: 'in_progress',
          activeText: 'Stale page fetch',
          summary: 'Stale summary',
          usage: { totalTokens: 120, toolUses: 1, durationMs: 3000 }
        }
      }
    )

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        status: 'completed',
        completedAt: '2026-08-12T01:05:00.000Z',
        activeText: 'Fetching final page',
        summary: 'Fetched every page',
        usage: { totalTokens: 200, toolUses: 3, durationMs: 5000 }
      })
    ])
  })

  it('keeps a stopped task terminal when liveness no longer reports it', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'bg-1', status: 'in_progress', title: 'Fetch latest' }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'notification', taskId: 'bg-1', status: 'stopped', summary: 'stopped by user' }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts }, {}, [], {
      activeMessageIds: new Set()
    })

    expect(status.runTasks).toEqual([expect.objectContaining({ id: 'bg-1', status: 'stopped' })])
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
          summary: 'slept'
        }
      }
    )

    // Merged by task id onto the part-derived row, keeping what only the parts knew.
    expect(settled.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        status: 'completed',
        taskType: 'local_bash'
      })
    ])
  })

  it('uses aggregate launch identity when a background Bash lifecycle edge omits its tool use id', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'bash-other',
        toolName: 'Bash',
        state: 'output-available',
        input: { command: 'echo other' },
        output: 'other output'
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'bash-background',
        toolName: 'Bash',
        state: 'output-available',
        input: { command: 'pnpm dev' },
        output: {
          stdout: 'ready on http://localhost:5173',
          stderr: 'warning: fixture',
          interrupted: false,
          backgroundTaskId: 'bg-1'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'bg-1',
          status: 'in_progress',
          title: 'Start dev server',
          createdAt: '2026-08-12T01:00:00.000Z'
        }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts }, {}, [
      { id: 'bg-1', type: 'local_bash', description: 'Start dev server', toolCallId: 'bash-background' }
    ])

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        toolUseId: 'bash-background',
        taskType: 'local_bash',
        command: 'pnpm dev',
        output: 'ready on http://localhost:5173\nwarning: fixture',
        createdAt: '2026-08-12T01:00:00.000Z'
      })
    ])
    expect(status.runTasks[0].output).not.toContain('backgroundTaskId')
    expect(status.runTasks[0].output).not.toContain('interrupted')
  })

  it('keeps failed background Bash logs from an output-error tool part', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'bash-failed',
        toolName: 'Bash',
        state: 'output-error',
        input: { command: 'pnpm test' },
        errorText: 'Command failed\nlast command output'
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'bg-failed',
          toolUseId: 'bash-failed',
          status: 'error',
          title: 'Run tests',
          taskType: 'local_bash'
        }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts })

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-failed',
        command: 'pnpm test',
        output: 'Command failed\nlast command output'
      })
    ])
  })

  it('keeps oversized background Bash output as a resolvable deferred value', () => {
    const deferredOutput = {
      $deferredToolResult: { topicId: 'agent-session:session-a', messageId: 'm1', toolCallId: 'bash-background' }
    }
    const parts = [
      toolPart('bash-background', 'Bash', undefined, 'output-available', { command: 'pnpm dev' }, deferredOutput),
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'bg-1',
          toolUseId: 'bash-background',
          status: 'in_progress',
          title: 'Start dev server',
          taskType: 'local_bash'
        }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus([message('m1', parts)], { m1: parts })

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'bg-1',
        command: 'pnpm dev',
        deferredOutput
      })
    ])
    expect(status.runTasks[0].output).toBeUndefined()
  })

  it('keeps the complete workflow snapshot and lifecycle timestamps on the projected run', () => {
    const workflow = {
      runId: 'run-1',
      taskId: 'workflow-1',
      workflowName: 'review-pr',
      phases: [{ title: 'Inspect' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Inspect' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Inspect:renderer',
          phaseIndex: 1,
          phaseTitle: 'Inspect',
          state: 'done',
          tokens: 1200,
          toolCalls: 4,
          durationMs: 9000
        }
      ]
    } satisfies AgentWorkflowSnapshot
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-1',
          status: 'in_progress',
          title: 'Review pull request',
          taskType: 'local_workflow',
          createdAt: '2026-08-12T01:00:00.000Z',
          workflow
        }
      }
    ] as unknown as CherryMessagePart[]

    const status = buildAgentRightPaneStatus(
      [message('m1', parts)],
      { m1: parts },
      {
        'workflow-1': {
          event: 'notification',
          taskId: 'workflow-1',
          status: 'completed',
          completedAt: '2026-08-12T01:01:00.000Z',
          workflow: { ...workflow, durationMs: 60_000 }
        }
      }
    )

    expect(status.runTasks).toEqual([
      expect.objectContaining({
        id: 'workflow-1',
        createdAt: '2026-08-12T01:00:00.000Z',
        completedAt: '2026-08-12T01:01:00.000Z',
        workflow: expect.objectContaining({
          durationMs: 60_000,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({ type: 'workflow_agent', label: 'Inspect:renderer', tokens: 1200 })
          ])
        })
      })
    ])
  })

  it.each([
    ['completed', 'completed'],
    ['stopped', 'interrupted'],
    ['error', 'interrupted']
  ] as const)('settles active workflow agents when the run becomes %s without a new snapshot', (status, state) => {
    const workflow = {
      runId: 'run-1',
      taskId: 'workflow-1',
      phases: [{ title: 'Review' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'active-agent',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'running'
        },
        {
          type: 'workflow_agent',
          index: 2,
          label: 'queued-agent',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'queued'
        }
      ]
    } satisfies AgentWorkflowSnapshot
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-1',
          status: 'in_progress',
          title: 'Review',
          taskType: 'local_workflow',
          workflow
        }
      }
    ] as unknown as CherryMessagePart[]

    const projected = buildAgentRightPaneStatus(
      [message('m1', parts)],
      { m1: parts },
      {
        'workflow-1': {
          event: 'notification',
          taskId: 'workflow-1',
          status
        }
      }
    )

    expect(projected.runTasks[0].workflow?.workflowProgress).toEqual([
      expect.objectContaining({ type: 'workflow_phase', title: 'Review' }),
      expect.objectContaining({ label: 'active-agent', state }),
      expect.objectContaining({ label: 'queued-agent', state: 'queued' })
    ])
  })

  // An interrupted turn kills its subagents without a completion event, so the persisted parts end
  // at in_progress forever. Liveness — not the events — decides whether a row still spins.
  it('stops a run task the session is no longer running', () => {
    const workflow = {
      runId: 'run-1',
      taskId: 'workflow-1',
      workflowName: 'review-pr',
      phases: [{ title: 'Review' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'running-agent',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'running'
        },
        {
          type: 'workflow_agent',
          index: 2,
          label: 'queued-agent',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'queued'
        },
        {
          type: 'workflow_agent',
          index: 3,
          label: 'done-agent',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'done'
        }
      ]
    } satisfies AgentWorkflowSnapshot
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-1',
          status: 'in_progress',
          title: 'Review',
          taskType: 'local_workflow',
          workflow
        }
      },
      {
        type: 'data-agent-task-event',
        data: { event: 'progress', taskId: 'workflow-1', status: 'in_progress', description: 'Reading files' }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [message('m1', parts)]

    const live = buildAgentRightPaneStatus(messages, { m1: parts }, {}, [], {
      activeMessageIds: new Set(['m1'])
    })
    expect(live.runTasks).toEqual([expect.objectContaining({ id: 'workflow-1', status: 'in_progress' })])

    const backgrounded = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      [{ id: 'workflow-1', type: 'local_workflow', description: 'Review' }],
      { activeMessageIds: new Set() }
    )
    expect(backgrounded.runTasks).toEqual([expect.objectContaining({ id: 'workflow-1', status: 'in_progress' })])

    const stale = buildAgentRightPaneStatus(messages, { m1: parts }, {}, [], {
      activeMessageIds: new Set()
    })
    expect(stale.runTasks).toEqual([
      expect.objectContaining({
        id: 'workflow-1',
        status: 'error',
        activeText: undefined,
        workflow: expect.objectContaining({
          workflowProgress: [
            expect.objectContaining({ type: 'workflow_phase', title: 'Review' }),
            expect.objectContaining({ label: 'running-agent', state: 'interrupted' }),
            expect.objectContaining({ label: 'queued-agent', state: 'queued' }),
            expect.objectContaining({ label: 'done-agent', state: 'done' })
          ]
        })
      })
    ])
    expect(workflow.workflowProgress).toEqual([
      expect.objectContaining({ type: 'workflow_phase', title: 'Review' }),
      expect.objectContaining({ label: 'running-agent', state: 'running' }),
      expect.objectContaining({ label: 'queued-agent', state: 'queued' }),
      expect.objectContaining({ label: 'done-agent', state: 'done' })
    ])
  })

  it('does not resurrect a historical run when an unrelated later turn starts', () => {
    const historicalParts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'agent-1',
          status: 'in_progress',
          title: 'Historical review',
          taskType: 'subagent'
        }
      }
    ] as unknown as CherryMessagePart[]
    const currentParts = [textPart('new turn')]
    const messages = [message('historical', historicalParts), message('current', currentParts)]

    const status = buildAgentRightPaneStatus(messages, { historical: historicalParts, current: currentParts }, {}, [], {
      activeMessageIds: new Set(['current'])
    })

    expect(status.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'error', activeText: undefined })
    ])
  })
})
