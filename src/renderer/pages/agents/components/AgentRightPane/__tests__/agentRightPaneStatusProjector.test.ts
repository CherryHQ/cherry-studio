import { describe, expect, it } from 'vitest'

import type { AgentSessionBackgroundTasks } from '@shared/ai/agentSessionBackgroundTasks'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import { createAgentRightPaneStatusProjector } from '../agentRightPaneProjection'

function message(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: 'assistant', parts, metadata: { status: 'pending' } }
}

function event(taskId: string, data: Partial<AgentTaskEventPartData> = {}): CherryMessagePart {
  return {
    type: 'data-agent-task-event',
    data: { taskId, event: 'started', title: taskId, status: 'in_progress', ...data }
  }
}

function tool(toolCallId: string, toolName: string, input: unknown, output?: unknown): CherryMessagePart {
  return { type: 'dynamic-tool', toolCallId, toolName, state: 'output-available', input, output }
}

describe('cached agent right pane status', () => {
  it('keeps the published status stable across text and unrelated tool output updates', () => {
    const project = createAgentRightPaneStatusProjector()
    const started = event('sync-agent', { taskType: 'subagent', isBackgrounded: false })
    const messages = [message('m1', [started, { type: 'text', text: 'First chunk' }])]
    const first = project(messages, {})
    const next = project(messages, {
      m1: [started, { type: 'text', text: 'Next chunk' }, tool('read', 'Read', {}, 'File contents')]
    })

    expect(next.runTasks).toEqual([
      expect.objectContaining({ id: 'sync-agent', taskType: 'subagent', isBackgrounded: false, status: 'in_progress' })
    ])
    // Stable published snapshots keep text streaming from invalidating status consumers.
    expect(next).toBe(first)
  })

  it('updates an asynchronous agent without invalidating the synchronous agent, workflow or shell', () => {
    const project = createAgentRightPaneStatusProjector()
    const messages = [
      message('m1', [
        event('sync', { taskType: 'subagent', isBackgrounded: false }),
        event('async', { taskType: 'subagent', isBackgrounded: true }),
        event('workflow', {
          taskType: 'local_workflow',
          workflow: {
            runId: 'run',
            taskId: 'workflow',
            phases: [{ title: 'Review' }],
            workflowProgress: []
          }
        }),
        event('shell', { taskType: 'shell', isBackgrounded: true })
      ])
    ]
    const first = project(messages, {})
    const completed = project(
      messages,
      {},
      {
        async: { event: 'notification', taskId: 'async', status: 'completed', usage: { totalTokens: 123 } }
      }
    )

    expect(completed.runTasks[1]).toMatchObject({
      id: 'async',
      taskType: 'subagent',
      isBackgrounded: true,
      status: 'completed',
      usage: { totalTokens: 123 }
    })
    for (const index of [0, 2, 3]) expect(completed.runTasks[index]).toBe(first.runTasks[index])
    expect(first.runTasks[1].status).toBe('in_progress')

    const reconnected = project(messages, {})
    expect(reconnected.runTasks[1].status).toBe('in_progress')
    expect(completed.runTasks[1].status).toBe('completed')
  })

  it('rebuilds edited, reordered and removed history without retaining the previous plan', () => {
    const project = createAgentRightPaneStatusProjector()
    const older = message('older', [
      tool('todo-older', 'TodoWrite', { todos: [{ content: 'Old plan', status: 'completed' }] })
    ])
    const current = message('current', [
      tool('todo-current', 'TodoWrite', { todos: [{ content: 'Current plan', status: 'pending' }] })
    ])
    const first = project([current], {})
    expect(first.tasks).toEqual([{ id: 'todo:0:Current plan', title: 'Current plan', status: 'pending' }])
    expect(project([older, current], {}).tasks).toEqual(first.tasks)
    expect(project([current, older], {}).tasks).toEqual([
      { id: 'todo:0:Old plan', title: 'Old plan', status: 'completed' }
    ])

    const corrected = tool('todo-current', 'TodoWrite', {
      todos: [{ content: 'Corrected plan', status: 'in_progress' }]
    })
    expect(project([current], { current: [corrected] }).tasks).toEqual([
      { id: 'todo:0:Corrected plan', title: 'Corrected plan', status: 'in_progress' }
    ])
    expect(project([], {})).toEqual({
      tasks: [],
      totalTaskCount: 0,
      completedTaskCount: 0,
      runTasks: [],
      artifacts: []
    })
    expect(first.tasks[0].title).toBe('Current plan')
  })

  it('reconciles foreground liveness and detached membership even when transcript inputs stay unchanged', () => {
    const project = createAgentRightPaneStatusProjector()
    const messages = [
      message('m1', [
        event('sync', { taskType: 'subagent', isBackgrounded: false }),
        event('async', { taskType: 'subagent', isBackgrounded: true })
      ])
    ]
    const background: AgentSessionBackgroundTasks = [{ id: 'async', type: 'subagent', description: 'Async agent' }]
    const running = project(messages, {}, {}, background, { activeMessageIds: new Set(['m1']) })
    expect(running.runTasks.map((task) => task.status)).toEqual(['in_progress', 'in_progress'])

    const handoff = project(messages, {}, {}, background, { activeMessageIds: new Set() })
    expect(handoff.runTasks.map((task) => task.status)).toEqual(['pending', 'in_progress'])
    const laterTurn = project(messages, {}, {}, [], { activeMessageIds: new Set(['m2']) })
    expect(laterTurn.runTasks.map((task) => task.status)).toEqual(['error', 'error'])
    expect(running.runTasks.map((task) => task.status)).toEqual(['in_progress', 'in_progress'])
  })

  it('refreshes background command output and preserves a deferred result until it is requested', () => {
    const project = createAgentRightPaneStatusProjector()
    const started = event('shell', { taskType: 'shell', toolUseId: 'bash', isBackgrounded: true })
    const deferred = { $deferredToolResult: { topicId: 'topic', messageId: 'm1', toolCallId: 'bash' } }
    const bash = tool('bash', 'Bash', { command: 'pnpm build' }, deferred)
    const messages = [message('m1', [started, bash])]
    const first = project(messages, {})
    expect(first.runTasks[0]).toMatchObject({ command: 'pnpm build', deferredOutput: deferred })
    expect(first.runTasks[0].output).toBeUndefined()

    const next = project(messages, {
      m1: [started, tool('bash', 'Bash', { command: 'pnpm build' }, { stdout: 'Build complete', stderr: 'Warning' })]
    })
    expect(next.runTasks[0]).toMatchObject({ command: 'pnpm build', output: 'Build complete\nWarning' })
    expect(next.runTasks[0].deferredOutput).toBeUndefined()
    expect(first.runTasks[0].deferredOutput).toBe(deferred)
  })

  it('preserves original part positions when assigning a missing task id', () => {
    const project = createAgentRightPaneStatusProjector()
    const update = {
      type: 'dynamic-tool',
      toolName: 'TaskUpdate',
      state: 'output-available',
      input: { subject: 'Recover task', status: 'in_progress' },
      output: {}
    } as CherryMessagePart
    const status = project(
      [message('m1', [{ type: 'text', text: 'Before task' }, tool('read', 'Read', {}), update])],
      {}
    )
    expect(status.tasks).toEqual([{ id: 'm1-2', title: 'Recover task', status: 'in_progress', activeText: undefined }])
  })

  it('accepts final workflow statistics without mutating the cached running snapshot', () => {
    const project = createAgentRightPaneStatusProjector()
    const workflow = {
      runId: 'run',
      taskId: 'workflow',
      phases: [{ title: 'Review' }],
      workflowProgress: [
        {
          type: 'workflow_agent' as const,
          index: 1,
          label: 'Reviewer',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'running',
          tokens: 10
        }
      ]
    }
    const messages = [message('m1', [event('workflow', { taskType: 'local_workflow', workflow })])]
    const running = project(messages, {})
    const terminal = { event: 'notification' as const, taskId: 'workflow', status: 'completed' as const }
    const completed = project(messages, {}, { workflow: terminal })
    const enriched = project(
      messages,
      {},
      {
        workflow: { ...terminal, workflow: { ...workflow, totalTokens: 456, totalToolCalls: 9 } }
      }
    )

    expect(enriched.runTasks[0]).toMatchObject({
      status: 'completed',
      workflow: { totalTokens: 456, totalToolCalls: 9, workflowProgress: [{ state: 'completed' }] }
    })
    expect(completed.runTasks[0].workflow?.totalTokens).toBeUndefined()
    expect(running.runTasks[0].workflow?.workflowProgress[0]).toMatchObject({ state: 'running', tokens: 10 })
    expect(project(messages, {}).runTasks[0]).toMatchObject({
      status: 'in_progress',
      workflow: { workflowProgress: [{ state: 'running', tokens: 10 }] }
    })
  })
})
