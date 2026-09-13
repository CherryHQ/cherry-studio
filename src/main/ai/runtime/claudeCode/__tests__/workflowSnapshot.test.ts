import { describe, expect, it } from 'vitest'

import type { AgentWorkflowSnapshot } from '@shared/ai/agentWorkflowProgress'

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

  it('keeps the earliest match and releases old aliases when Agent indexes and labels change', () => {
    const plan = {
      phases: [{ title: 'Review' }],
      agents: ['shared', 'second', 'shared', 'later'].map((label) => ({
        label,
        phaseIndex: 1,
        phaseTitle: 'Review'
      }))
    }
    const progress = (index: number, label: string, tokens: number) => ({
      type: 'workflow_agent',
      index,
      label,
      phaseIndex: 1,
      phaseTitle: 'Review',
      state: 'progress',
      tokens
    })

    const snapshot = updateLocalWorkflowSnapshot(
      plan,
      { runId: 'run-1', taskId: 'task-1' },
      {
        status: 'in_progress',
        workflowProgress: [
          progress(2, 'shared', 10),
          progress(2, 'renamed', 20),
          progress(9, 'shared', 30),
          progress(2, 'second', 40),
          progress(10, 'renamed', 50),
          progress(1, 'new', 60)
        ]
      }
    )

    expect(
      snapshot.workflowProgress
        .filter((item) => item.type === 'workflow_agent')
        .map(({ index, label, tokens }) => ({ index, label, tokens }))
    ).toEqual([
      { index: 1, label: 'new', tokens: 60 },
      { index: 2, label: 'second', tokens: 40 },
      { index: 2, label: 'second', tokens: undefined },
      { index: 4, label: 'later', tokens: undefined },
      { index: 9, label: 'shared', tokens: 30 },
      { index: 10, label: 'renamed', tokens: 50 }
    ])
    expect(snapshot.totalTokens).toBe(180)
  })

  it('keeps same-named Agents in separate phases and retains discovered phases at completion', () => {
    const plan = {
      phases: [{ title: 'Review' }, { title: 'Verify' }],
      agents: [
        { label: 'worker', phaseIndex: 1, phaseTitle: 'Review' },
        { label: 'worker', phaseIndex: 2, phaseTitle: 'Verify' }
      ]
    }
    const launch = { runId: 'run-1', taskId: 'task-1' }
    const previous = updateLocalWorkflowSnapshot(plan, launch, {
      status: 'in_progress',
      workflowProgress: [
        { type: 'workflow_phase', index: 3, title: 'Publish' },
        {
          type: 'workflow_agent',
          index: 3,
          label: 'publisher',
          phaseIndex: 3,
          phaseTitle: 'Publish',
          state: 'done',
          cumulativeTokens: 200
        }
      ]
    })
    const completed = updateLocalWorkflowSnapshot(
      plan,
      launch,
      {
        status: 'completed',
        usage: { contextTokens: 90, toolUses: 5 },
        workflowProgress: [
          { type: 'workflow_phase', index: 3, title: 'Publish' },
          {
            type: 'workflow_agent',
            index: 4,
            label: 'worker',
            phaseIndex: 2,
            phaseTitle: 'Verify',
            state: 'progress',
            cumulativeTokens: 100,
            toolCalls: 1
          }
        ]
      },
      previous
    )

    expect(completed.phases).toEqual([{ title: 'Review' }, { title: 'Verify' }, { title: 'Publish' }])
    expect(
      completed.workflowProgress
        .filter((item) => item.type === 'workflow_agent')
        .map(({ index, label, phaseTitle, state }) => ({ index, label, phaseTitle, state }))
    ).toEqual([
      { index: 1, label: 'worker', phaseTitle: 'Review', state: 'pending' },
      { index: 3, label: 'publisher', phaseTitle: 'Publish', state: 'done' },
      { index: 4, label: 'worker', phaseTitle: 'Verify', state: 'done' }
    ])
    expect(completed).toMatchObject({ totalTokens: 90, totalCumulativeTokens: 300, totalToolCalls: 5 })
    expect(previous.workflowProgress).toContainEqual(
      expect.objectContaining({ index: 2, label: 'worker', phaseTitle: 'Verify', state: 'pending' })
    )
  })
})
