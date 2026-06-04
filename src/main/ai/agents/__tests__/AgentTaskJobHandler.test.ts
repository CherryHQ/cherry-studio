import type { JobContext, JobSettledEvent } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('@data/services/JobService', () => ({
  jobService: {
    listRecentTerminalByScheduleId: vi.fn()
  }
}))

vi.mock('../runAgentTask', () => ({
  runAgentTask: vi.fn()
}))

import { application } from '@application'
import { jobService } from '@data/services/JobService'

import { AgentTaskJobHandler } from '../AgentTaskJobHandler'
import { runAgentTask } from '../runAgentTask'

function makeTerminal(status: 'completed' | 'failed' | 'cancelled', id = `job-${status}`): JobSnapshot {
  return {
    id,
    type: 'agent.task',
    status,
    priority: 0,
    queue: 'agent:a1',
    idempotencyKey: null,
    scheduleId: 's1',
    scheduledAt: '2026-05-20T00:00:00.000Z',
    startedAt: '2026-05-20T00:00:01.000Z',
    finishedAt: '2026-05-20T00:00:02.000Z',
    attempt: 0,
    maxAttempts: 1,
    input: {},
    output: null,
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:02.000Z'
  }
}

function makeSettled(overrides: Partial<JobSettledEvent>): JobSettledEvent {
  return {
    jobId: 'job-1',
    type: 'agent.task',
    scheduleId: 's1',
    status: 'failed',
    output: null,
    error: { code: 'TEST', message: 'boom', retryable: false },
    attempt: 0,
    ...overrides
  } as JobSettledEvent
}

describe('AgentTaskJobHandler', () => {
  const pauseSpy = vi.fn()

  beforeEach(() => {
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'JobManager') return { pauseJobScheduleById: pauseSpy } as never
      throw new Error(`Unexpected application.get('${name}')`)
    })
    pauseSpy.mockReset()
    pauseSpy.mockResolvedValue(true)
    vi.mocked(jobService.listRecentTerminalByScheduleId).mockReset()
    vi.mocked(runAgentTask).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('metadata', () => {
    it('declares per-agent queue + concurrency 1 + retry-once policy', () => {
      expect(AgentTaskJobHandler.recovery).toBe('retry')
      expect(AgentTaskJobHandler.defaultConcurrency).toBe(1)
      expect(AgentTaskJobHandler.defaultRetryPolicy).toEqual({
        maxAttempts: 1,
        backoff: 'none',
        baseDelayMs: 0,
        maxDelayMs: 0
      })
      expect(AgentTaskJobHandler.defaultQueue?.({ agentId: 'a-42', prompt: 'x', timeoutMinutes: 2 })).toBe('agent:a-42')
    })
  })

  describe('execute', () => {
    it('delegates to runAgentTask with the JobContext', async () => {
      vi.mocked(runAgentTask).mockResolvedValueOnce({ sessionId: 'sess-1', result: 'ok' })
      const ctx = { jobId: 'j1', input: { agentId: 'a', prompt: 'p', timeoutMinutes: 2 } } as JobContext<{
        agentId: string
        prompt: string
        timeoutMinutes: number
      }>

      const out = await AgentTaskJobHandler.execute(ctx)

      expect(out).toEqual({ sessionId: 'sess-1', result: 'ok' })
      expect(runAgentTask).toHaveBeenCalledWith(ctx)
    })
  })

  describe('onSettled circuit breaker', () => {
    it('pauses schedule after 3 consecutive failures', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockResolvedValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b'),
        makeTerminal('failed', 'c')
      ])

      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(jobService.listRecentTerminalByScheduleId).toHaveBeenCalledWith('s1', 3)
      expect(pauseSpy).toHaveBeenCalledWith('s1')
    })

    it('does not pause when the latest is failed but a recent one is completed', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockResolvedValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('completed', 'b'),
        makeTerminal('failed', 'c')
      ])

      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(pauseSpy).not.toHaveBeenCalled()
    })

    it('does not pause when the recent-terminal window is not yet full', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockResolvedValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b')
      ])

      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(pauseSpy).not.toHaveBeenCalled()
    })

    it('does not act on non-failed terminal events', async () => {
      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'completed' }))
      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'cancelled' }))

      expect(jobService.listRecentTerminalByScheduleId).not.toHaveBeenCalled()
      expect(pauseSpy).not.toHaveBeenCalled()
    })

    it('does not act when the failed job has no scheduleId (ad-hoc enqueue)', async () => {
      await AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed', scheduleId: null }))

      expect(jobService.listRecentTerminalByScheduleId).not.toHaveBeenCalled()
      expect(pauseSpy).not.toHaveBeenCalled()
    })

    it('swallows pauseJobScheduleById errors so onSettled cannot throw', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockResolvedValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b'),
        makeTerminal('failed', 'c')
      ])
      pauseSpy.mockRejectedValueOnce(new Error('db lost'))

      await expect(AgentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))).resolves.not.toThrow()
    })
  })
})
