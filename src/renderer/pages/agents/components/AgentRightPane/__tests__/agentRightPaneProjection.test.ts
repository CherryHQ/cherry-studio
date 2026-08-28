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

  it('keeps a foreground task result when its lifecycle event is present', () => {
    const selected = toolPart(
      'root',
      'Agent',
      undefined,
      'output-available',
      { prompt: 'Explore the repo' },
      'Repository review complete'
    )
    const started = {
      type: 'data-agent-task-event',
      data: {
        event: 'started',
        taskId: 'task-1',
        toolUseId: 'root',
        status: 'in_progress',
        title: 'Explore the repo'
      }
    } as unknown as CherryMessagePart
    const parts = [selected, started]

    const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')

    expect(projection.partsByMessageId['root:agent-flow-assistant']).toEqual([
      { type: 'text', text: 'Repository review complete' }
    ])
  })

  it('hides a legacy background launch receipt without borrowing task status', () => {
    const selected = toolPart(
      'root',
      'Agent',
      undefined,
      'output-available',
      { prompt: 'Explore the repo' },
      'Async agent launched successfully. Internal id: task-1; output_file: /tmp/task-1.output'
    )
    const parts = [selected, textPart('child agent text', 'root')]

    const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')
    const assistantParts = projection.partsByMessageId['root:agent-flow-assistant'] as Array<{ text?: string }>

    expect(assistantParts.map((part) => part.text).filter(Boolean)).toEqual(['child agent text'])
    expect(JSON.stringify(assistantParts)).not.toContain('Async agent launched successfully')
    expect(JSON.stringify(assistantParts)).not.toContain('/tmp/task-1.output')
  })

  it.each(['async_launched', 'remote_launched'] as const)(
    'hides a structured %s receipt without borrowing task status',
    (status) => {
      const selected = toolPart(
        'root',
        'Agent',
        undefined,
        'output-available',
        { prompt: 'Explore the repo' },
        { status, agentId: 'internal-agent-id' }
      )
      const parts = [selected, textPart('child agent text', 'root')]

      const projection = buildAgentToolFlowProjection([message('m1', parts)], { m1: parts }, 'root')
      const assistantParts = projection.partsByMessageId['root:agent-flow-assistant']

      expect(assistantParts).toEqual([expect.objectContaining({ type: 'text', text: 'child agent text' })])
      expect(JSON.stringify(assistantParts)).not.toContain('internal-agent-id')
    }
  )

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
          lastToolName: 'Read',
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
        toolUseId: 'tool-use-1',
        title: 'Inspect task state',
        activeText: 'Reading renderer state',
        status: 'completed',
        taskType: 'subagent',
        subagentType: 'code-reviewer',
        workflowName: undefined,
        summary: 'Inspect task state',
        lastToolName: 'Read',
        outputFile: '/tmp/task-1.md',
        usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
      }
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

    const status = buildAgentRightPaneStatus(
      [message('m1', parts)],
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set() }
    )

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

  // An interrupted turn kills its subagents without a completion event, so the persisted parts end
  // at in_progress forever. Liveness — not the events — decides whether a row still spins.
  it('stops a run task the session is no longer running', () => {
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

    const live = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(['m1']), liveBackgroundTaskIds: new Set() }
    )
    expect(live.runTasks).toEqual([expect.objectContaining({ id: 'agent-1', status: 'in_progress' })])

    const backgrounded = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set(['agent-1']) }
    )
    expect(backgrounded.runTasks).toEqual([expect.objectContaining({ id: 'agent-1', status: 'in_progress' })])

    const stale = buildAgentRightPaneStatus(
      messages,
      { m1: parts },
      {},
      { activeMessageIds: new Set(), liveBackgroundTaskIds: new Set() }
    )
    expect(stale.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending', activeText: undefined })
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

    const status = buildAgentRightPaneStatus(
      messages,
      { historical: historicalParts, current: currentParts },
      {},
      { activeMessageIds: new Set(['current']), liveBackgroundTaskIds: new Set() }
    )

    expect(status.runTasks).toEqual([
      expect.objectContaining({ id: 'agent-1', status: 'pending', activeText: undefined })
    ])
  })
})
