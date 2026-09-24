import { describe, expect, it } from 'vitest'

import { mergeAgentSessionTaskEvent } from '../agentSessionBackgroundTasks'

describe('mergeAgentSessionTaskEvent', () => {
  it('keeps identity from the start edge when a terminal notification omits it', () => {
    const started = {
      event: 'started' as const,
      taskId: 'workflow-1',
      toolUseId: 'tool-1',
      status: 'in_progress' as const,
      title: 'Review pull request',
      taskType: 'local_workflow'
    }

    expect(
      mergeAgentSessionTaskEvent(started, {
        event: 'notification',
        taskId: 'workflow-1',
        status: 'completed',
        summary: 'Review complete'
      })
    ).toEqual({
      ...started,
      event: 'notification',
      status: 'completed',
      summary: 'Review complete'
    })
  })

  it('does not let late progress overwrite terminal task results', () => {
    const completed = {
      event: 'notification' as const,
      taskId: 'workflow-1',
      toolUseId: 'tool-1',
      status: 'completed' as const,
      completedAt: '2026-08-12T08:05:00.000Z',
      title: 'Review pull request',
      activeText: 'Finalizing review',
      summary: 'Review complete',
      taskType: 'local_workflow',
      workflowName: 'review-pr',
      workflow: {
        runId: 'run-1',
        taskId: 'workflow-1',
        totalTokens: 200,
        phases: [{ title: 'Review' }],
        workflowProgress: []
      },
      usage: { totalTokens: 200, toolUses: 4, durationMs: 5000 }
    }

    expect(
      mergeAgentSessionTaskEvent(completed, {
        event: 'progress',
        taskId: 'workflow-1',
        createdAt: '2026-08-12T08:00:00.000Z',
        toolUseId: 'late-tool',
        status: 'in_progress',
        title: 'Review in progress',
        activeText: 'Reading renderer state',
        summary: 'Review in progress',
        subagentType: 'reviewer',
        taskType: 'subagent',
        workflowName: 'late-review',
        prompt: 'Ignore the final result',
        lastToolName: 'Read',
        isBackgrounded: true,
        skipTranscript: true,
        workflow: {
          runId: 'run-1',
          taskId: 'workflow-1',
          totalTokens: 120,
          phases: [{ title: 'Review' }],
          workflowProgress: []
        },
        usage: { totalTokens: 120, toolUses: 3, durationMs: 3000 }
      })
    ).toEqual({
      ...completed,
      createdAt: '2026-08-12T08:00:00.000Z',
      subagentType: 'reviewer'
    })
  })

  it('uses late non-terminal edges to fill empty terminal identity fields', () => {
    expect(
      mergeAgentSessionTaskEvent(
        {
          event: 'updated',
          taskId: 'workflow-1',
          status: 'completed',
          title: ''
        },
        {
          event: 'started',
          taskId: 'workflow-1',
          status: 'in_progress',
          title: 'Review pull request'
        }
      )
    ).toEqual({
      event: 'updated',
      taskId: 'workflow-1',
      status: 'completed',
      title: 'Review pull request'
    })
  })

  it('preserves transcript totals while accepting authoritative final context and tool counts', () => {
    const progress = {
      event: 'progress' as const,
      taskId: 'agent-1',
      status: 'in_progress' as const,
      usage: { totalTokens: 5600, contextTokens: 2000, toolUses: 9, durationMs: 16_000 }
    }

    expect(
      mergeAgentSessionTaskEvent(progress, {
        event: 'notification',
        taskId: 'agent-1',
        status: 'completed',
        usage: { contextTokens: 2100, toolUses: 7, durationMs: 15_000 }
      })
    ).toEqual({
      ...progress,
      event: 'notification',
      status: 'completed',
      usage: { totalTokens: 5600, contextTokens: 2100, toolUses: 7, durationMs: 15_000 }
    })
  })

  it('does not let a duplicate terminal edge regress cumulative usage counters', () => {
    const completed = {
      event: 'notification' as const,
      taskId: 'agent-1',
      status: 'completed' as const,
      usage: { totalTokens: 5600, contextTokens: 2100, toolUses: 7, durationMs: 15_000 }
    }

    expect(
      mergeAgentSessionTaskEvent(completed, {
        event: 'notification',
        taskId: 'agent-1',
        status: 'completed',
        usage: { totalTokens: 5400, contextTokens: 2050, toolUses: 6, durationMs: 14_000 }
      })
    ).toEqual({
      ...completed,
      usage: { totalTokens: 5600, contextTokens: 2050, toolUses: 7, durationMs: 15_000 }
    })
  })

  it('keeps cumulative counters monotonic while accepting the latest running context size', () => {
    const progress = {
      event: 'progress' as const,
      taskId: 'agent-1',
      status: 'in_progress' as const,
      usage: { totalTokens: 5600, contextTokens: 2000, toolUses: 6, durationMs: 12_000 }
    }

    expect(
      mergeAgentSessionTaskEvent(progress, {
        event: 'progress',
        taskId: 'agent-1',
        status: 'in_progress',
        usage: { totalTokens: 5400, contextTokens: 1800, toolUses: 5, durationMs: 11_000 }
      })
    ).toEqual({
      ...progress,
      usage: { totalTokens: 5600, contextTokens: 1800, toolUses: 6, durationMs: 12_000 }
    })
  })

  it('lets a real terminal edge supersede a synthesized interruption', () => {
    const interrupted = {
      event: 'started' as const,
      taskId: 'bg-1',
      status: 'error' as const,
      completedAt: '2026-08-12T08:05:00.000Z',
      error: 'Interrupted by app restart before task completed',
      synthetic: true
    }

    expect(
      mergeAgentSessionTaskEvent(interrupted, {
        event: 'notification',
        taskId: 'bg-1',
        status: 'completed',
        completedAt: '2026-08-12T08:09:00.000Z'
      })
    ).toEqual({
      event: 'notification',
      taskId: 'bg-1',
      status: 'completed',
      completedAt: '2026-08-12T08:09:00.000Z'
    })
  })

  it('does not let late progress revive a synthesized interruption', () => {
    const interrupted = {
      event: 'started' as const,
      taskId: 'bg-1',
      status: 'error' as const,
      completedAt: '2026-08-12T08:05:00.000Z',
      error: 'Interrupted by app restart before task completed',
      synthetic: true
    }

    expect(
      mergeAgentSessionTaskEvent(interrupted, { event: 'progress', taskId: 'bg-1', status: 'in_progress' })
    ).toEqual({ ...interrupted })
  })

  it('keeps a runtime-reported terminal edge final', () => {
    const failed = {
      event: 'notification' as const,
      taskId: 'bg-1',
      status: 'error' as const,
      error: 'Command exited with 1'
    }

    expect(mergeAgentSessionTaskEvent(failed, { event: 'notification', taskId: 'bg-1', status: 'completed' })).toEqual({
      ...failed
    })
  })

  it('ignores a synthesized interruption that arrives after a real terminal edge', () => {
    const completed = {
      event: 'notification' as const,
      taskId: 'bg-1',
      status: 'completed' as const,
      completedAt: '2026-08-12T08:09:00.000Z'
    }

    expect(
      mergeAgentSessionTaskEvent(completed, {
        event: 'started',
        taskId: 'bg-1',
        status: 'error',
        error: 'Interrupted by user',
        synthetic: true
      })
    ).toEqual({ ...completed })
  })
})
