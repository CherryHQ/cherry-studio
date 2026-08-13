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
})
