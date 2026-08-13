import type { AgentWorkflowSnapshot } from '@shared/ai/agentWorkflowProgress'
import { describe, expect, it } from 'vitest'

import { updateLocalWorkflowSnapshot } from '../workflowSnapshot'

describe('updateLocalWorkflowSnapshot', () => {
  it('does not mutate a previous snapshot while advancing a retained Agent', () => {
    const previous: AgentWorkflowSnapshot = {
      runId: 'run-1',
      taskId: 'task-1',
      phases: [{ title: 'Review' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'reviewer',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'pending'
        }
      ]
    }

    const next = updateLocalWorkflowSnapshot(
      { phases: [{ title: 'Review' }], agents: [] },
      { runId: 'run-1', taskId: 'task-1' },
      { status: 'in_progress', description: 'Review: reviewer' },
      previous
    )

    expect(previous.workflowProgress[1]).toMatchObject({ state: 'pending' })
    expect(next.workflowProgress[1]).toMatchObject({ state: 'running' })
  })

  it('uses Agent tool-call totals while running and the SDK total at completion', () => {
    const plan = {
      phases: [{ title: 'Review' }],
      agents: [{ label: 'reviewer', phaseIndex: 1, phaseTitle: 'Review' }]
    }
    const launch = { runId: 'run-1', taskId: 'task-1' }
    const running = updateLocalWorkflowSnapshot(plan, launch, {
      status: 'in_progress',
      usage: { toolUses: 9 },
      workflowProgress: [
        {
          type: 'workflow_agent',
          index: 1,
          label: 'reviewer',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'progress',
          toolCalls: 2
        }
      ]
    })

    expect(running.totalToolCalls).toBe(2)

    const completed = updateLocalWorkflowSnapshot(
      plan,
      launch,
      { status: 'completed', usage: { toolUses: 9 } },
      running
    )

    expect(completed.totalToolCalls).toBe(9)
  })
})
