import type { AgentWorkflowSnapshot } from '@shared/ai/agentWorkflowProgress'
import { describe, expect, it } from 'vitest'

import { parseLocalWorkflowPlan, updateLocalWorkflowSnapshot } from '../workflowSnapshot'

describe('parseLocalWorkflowPlan', () => {
  it('parses escaped static fields while skipping nested template expressions', () => {
    const script = [
      "export const meta = { phases: [{ title: 'Rev\\u0069ew' }] }",
      'const ready = true',
      'await agent(`Inspect ${ready ? `nested ${value / 2}` : /}/.test(value)}`, {',
      "  label: 'review\\u{65}r',",
      "  phase: 'Rev\\u0069ew'",
      '})'
    ].join('\n')

    expect(parseLocalWorkflowPlan(script)).toEqual({
      phases: [{ title: 'Review' }],
      agents: [{ label: 'reviewer', phaseIndex: 1, phaseTitle: 'Review' }]
    })
  })

  it('ignores comments and regex literals while distinguishing division expressions', () => {
    const script = [
      'const ratio = total / count / 2',
      'const matcher = /agent\\([^)]*\\)\\/count/g',
      "// agent('comment', { label: 'ignored-line', phase: 'Ignored' })",
      "/* agent('comment', { label: 'ignored-block', phase: 'Ignored' }) */",
      "export const meta = { phases: [{ title: 'Verify' }] }",
      "await agent('Verify the result', { label: 'verifier', phase: 'Verify' })"
    ].join('\n')

    expect(parseLocalWorkflowPlan(script)).toEqual({
      phases: [{ title: 'Verify' }],
      agents: [{ label: 'verifier', phaseIndex: 1, phaseTitle: 'Verify' }]
    })
  })

  it.each([
    "export const meta = { phases: [{ title: 'Review' }]\nawait agent('x', { label: 'x', phase: 'Review' }",
    "export const meta = { phases: [{ title: 'unterminated }] }"
  ])('returns no plan for malformed input without throwing', (script) => {
    expect(() => parseLocalWorkflowPlan(script)).not.toThrow()
    expect(parseLocalWorkflowPlan(script)).toBeUndefined()
  })
})

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
