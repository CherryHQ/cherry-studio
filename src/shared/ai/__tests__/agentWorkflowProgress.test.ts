import { describe, expect, it } from 'vitest'

import { parseAgentWorkflowSnapshot } from '../agentWorkflowProgress'

describe('parseAgentWorkflowSnapshot', () => {
  it('keeps status-panel statistics while dropping unconsumed workflow metadata', () => {
    const snapshot = parseAgentWorkflowSnapshot({
      runId: 'run-1',
      taskId: 'task-1',
      summary: 'Reviewed the workspace',
      status: 'completed',
      startTime: 1_723_456_789,
      durationMs: 4200,
      agentCount: 2,
      totalTokens: 3200,
      totalCumulativeTokens: 6400,
      totalToolCalls: 7,
      logs: ['large log'],
      result: 'large result',
      phases: [{ title: 'Explore', detail: 'Inspect the TypeScript workspace' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Explore' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Explore:TypeScript',
          phaseIndex: 1,
          phaseTitle: 'Explore',
          agentId: 'agent-1',
          model: 'sonnet',
          state: 'done',
          queuedAt: 1_723_456_789,
          startedAt: 1_723_456_790,
          lastProgressAt: 1_723_456_791,
          attempt: 1,
          tokens: 3200,
          cumulativeTokens: 6400,
          toolCalls: 7,
          durationMs: 4200
        }
      ]
    })

    expect(snapshot).toEqual({
      runId: 'run-1',
      taskId: 'task-1',
      durationMs: 4200,
      totalTokens: 3200,
      totalCumulativeTokens: 6400,
      totalToolCalls: 7,
      phases: [{ title: 'Explore' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Explore' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'Explore:TypeScript',
          phaseIndex: 1,
          phaseTitle: 'Explore',
          state: 'done',
          startedAt: 1_723_456_790,
          tokens: 3200,
          cumulativeTokens: 6400,
          toolCalls: 7,
          durationMs: 4200
        }
      ]
    })
    expect(snapshot).not.toHaveProperty('logs')
    expect(snapshot).not.toHaveProperty('result')
    expect(snapshot).not.toHaveProperty('summary')
  })

  it('ignores malformed progress entries without losing a valid workflow completion', () => {
    expect(
      parseAgentWorkflowSnapshot({
        runId: 'run-1',
        taskId: 'task-1',
        totalTokens: 0,
        workflowProgress: [
          { type: 'workflow_phase', index: 1, title: '' },
          { type: 'future_progress_type', index: 2 }
        ]
      })
    ).toEqual({ runId: 'run-1', taskId: 'task-1', totalTokens: 0, phases: [], workflowProgress: [] })
  })

  it('keeps a duration-only workflow snapshot', () => {
    expect(parseAgentWorkflowSnapshot({ runId: 'run-1', taskId: 'task-1', durationMs: 0 })).toEqual({
      runId: 'run-1',
      taskId: 'task-1',
      durationMs: 0,
      phases: [],
      workflowProgress: []
    })
  })

  it('rejects a snapshot whose embedded identity conflicts with the launch receipt', () => {
    expect(
      parseAgentWorkflowSnapshot(
        { runId: 'other-run', taskId: 'task-1', totalTokens: 1 },
        { runId: 'run-1', taskId: 'task-1' }
      )
    ).toBeUndefined()
  })
})
