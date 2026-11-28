import { setupTestDatabase } from '@test-helpers/db'
import { mockNotificationService } from '@test-mocks/main/application'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext, JobSettledEvent } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('@data/services/JobService', () => ({
  jobService: {
    listRecentTerminalByScheduleId: vi.fn(),
    getById: vi.fn(),
    setMetadataTx: vi.fn()
  }
}))

vi.mock('../runAgentTask', () => ({
  runAgentTask: vi.fn()
}))

import { application } from '@application'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'

import { agentTaskJobHandler } from '../agentTaskJobHandler'
import { type AgentTaskInput, runAgentTask } from '../runAgentTask'
import { clearManualRun, markManualRun } from '../scheduledTaskAnalytics'

const WORKSPACE_SOURCE = { type: 'system' as const }

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
    cancelRequestedAt: null,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:02.000Z'
  }
}

function makeSettled(overrides: Partial<JobSettledEvent<AgentTaskInput>>): JobSettledEvent<AgentTaskInput> {
  return {
    jobId: 'job-1',
    type: 'agent.task',
    scheduleId: 's1',
    parentId: null,
    status: 'failed',
    input: {
      agentId: 'a1',
      prompt: '__heartbeat__',
      timeoutMinutes: 30,
      workspace: WORKSPACE_SOURCE,
      reuseRevision: 0
    },
    output: null,
    error: { code: 'TEST', message: 'boom', retryable: false },
    attempt: 0,
    metadata: {},
    ...overrides
  }
}

describe('AgentTaskJobHandler', () => {
  const dbh = setupTestDatabase()
  const updateTxSpy = vi.fn((tx, id, patch) => jobScheduleService.updateTx(tx, id, patch))
  const syncTimerSpy = vi.fn()
  const trackProductEvent = vi.fn()

  beforeEach(() => {
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'NotificationService') return mockNotificationService as never
      if (name === 'JobManager')
        return { updateJobScheduleTx: updateTxSpy, syncJobScheduleTimerById: syncTimerSpy } as never
      if (name === 'DbService') return MockMainDbServiceExport.dbService as never
      if (name === 'AnalyticsService') return { trackProductEvent } as never
      throw new Error(`Unexpected application.get('${name}')`)
    })
    updateTxSpy.mockClear()
    syncTimerSpy.mockReset()
    trackProductEvent.mockReset()
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: 's1',
        type: 'agent.task',
        name: 'heartbeat',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()
    vi.mocked(jobService.listRecentTerminalByScheduleId).mockReset()
    vi.mocked(jobService.getById).mockReset()
    vi.spyOn(agentTaskService, 'notifyRunChange').mockImplementation(() => {})
    vi.mocked(runAgentTask).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  describe('onEnqueued', () => {
    it('announces log membership while a scheduled job is still pending', () => {
      agentTaskJobHandler.onEnqueued?.({ ...makeTerminal('completed', 'j1'), status: 'pending', startedAt: null })

      expect(vi.mocked(agentTaskService.notifyRunChange).mock.calls).toEqual([['s1', 'j1', 'membership']])
    })

    it('does not announce task logs for an ad-hoc job', () => {
      agentTaskJobHandler.onEnqueued?.({ ...makeTerminal('completed', 'j1'), status: 'pending', scheduleId: null })

      expect(agentTaskService.notifyRunChange).not.toHaveBeenCalled()
    })
  })

  describe('execute', () => {
    it('publishes the run-state change before running so open task lists leave the previous state', async () => {
      vi.mocked(jobService.getById).mockReturnValueOnce(makeTerminal('completed', 'j1'))
      vi.mocked(runAgentTask).mockImplementationOnce(async () => {
        expect(vi.mocked(agentTaskService.notifyRunChange).mock.calls).toEqual([['s1', 'j1', 'projection']])
        return { kind: 'executed', result: 'ok' }
      })

      await agentTaskJobHandler.execute({ jobId: 'j1' } as JobContext<AgentTaskInput>)

      expect.assertions(1)
    })

    it('does not publish for an ad-hoc job with no schedule', async () => {
      vi.mocked(jobService.getById).mockReturnValueOnce({ ...makeTerminal('completed', 'j1'), scheduleId: null })

      await agentTaskJobHandler.execute({ jobId: 'j1' } as JobContext<AgentTaskInput>)

      expect(agentTaskService.notifyRunChange).not.toHaveBeenCalled()
    })
  })

  describe('onSettled circuit breaker', () => {
    it('pauses schedule after 3 consecutive failures', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b'),
        makeTerminal('failed', 'c')
      ])

      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(jobService.listRecentTerminalByScheduleId).toHaveBeenCalledWith('s1', 3)
      expect(jobScheduleService.getById('s1')).toMatchObject({
        enabled: false,
        metadata: { circuitBreakerPaused: true }
      })
      expect(syncTimerSpy).toHaveBeenCalledWith('s1')
    })

    it('does not pause when the latest is failed but a recent one is completed', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('completed', 'b'),
        makeTerminal('failed', 'c')
      ])

      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(jobScheduleService.getById('s1')?.enabled).toBe(true)
    })

    it('does not pause when the recent-terminal window is not yet full', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b')
      ])

      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))

      expect(jobScheduleService.getById('s1')?.enabled).toBe(true)
    })

    it('does not act on non-failed terminal events', async () => {
      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'completed' }))
      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'cancelled' }))

      expect(jobService.listRecentTerminalByScheduleId).not.toHaveBeenCalled()
      expect(jobScheduleService.getById('s1')?.enabled).toBe(true)
    })

    it.each(['completed', 'failed', 'cancelled'] as const)('publishes one run-state change on %s', async (status) => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValueOnce([])
      await agentTaskJobHandler.onSettled?.(makeSettled({ status }))

      expect(vi.mocked(agentTaskService.notifyRunChange).mock.calls).toEqual([['s1', 'job-1', 'projection']])
    })

    it('does not act when the failed job has no scheduleId (ad-hoc enqueue)', async () => {
      await agentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed', scheduleId: null }))

      expect(jobService.listRecentTerminalByScheduleId).not.toHaveBeenCalled()
      expect(jobScheduleService.getById('s1')?.enabled).toBe(true)
      expect(agentTaskService.notifyRunChange).not.toHaveBeenCalled()
    })

    it('swallows pause-write errors so onSettled cannot throw', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValueOnce([
        makeTerminal('failed', 'a'),
        makeTerminal('failed', 'b'),
        makeTerminal('failed', 'c')
      ])
      updateTxSpy.mockImplementationOnce(() => {
        throw new Error('db lost')
      })

      await expect(agentTaskJobHandler.onSettled?.(makeSettled({ status: 'failed' }))).resolves.not.toThrow()
    })
  })

  describe('onSettled run analytics', () => {
    const runs = () =>
      trackProductEvent.mock.calls.map(([event]) => event).filter((event) => event.event === 'scheduled_task_run')
    const threeFailures = () => [makeTerminal('failed', 'a'), makeTerminal('failed', 'b'), makeTerminal('failed', 'c')]

    it('reports a skipped heartbeat with its reason and run time, but no prompt or result text', async () => {
      vi.mocked(jobService.getById).mockReturnValue(makeTerminal('completed', 'job-1'))

      await agentTaskJobHandler.onSettled?.(
        makeSettled({
          status: 'completed',
          error: null,
          output: { kind: 'skipped', result: 'Skipped (no file)', skipReason: 'no_file' }
        })
      )

      expect(runs()).toEqual([
        {
          event: 'scheduled_task_run',
          kind: 'heartbeat',
          result: 'skipped',
          skipReason: 'no_file',
          run: 'scheduled',
          durationMs: 1000,
          channelCount: 0
        }
      ])
    })

    it('labels only the job a Run-now request enqueued, on the job row so recovery after a restart keeps it', async () => {
      markManualRun('s1')
      agentTaskJobHandler.onEnqueued?.({ ...makeTerminal('completed', 'job-1'), status: 'pending' })
      clearManualRun('s1')
      agentTaskJobHandler.onEnqueued?.({ ...makeTerminal('completed', 'job-2'), status: 'pending' })
      expect(vi.mocked(jobService.setMetadataTx).mock.calls.map(([, jobId, metadata]) => [jobId, metadata])).toEqual([
        ['job-1', { manualRun: true }]
      ])
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValue([])

      // A fresh process has no memory of the click; the settled row carries it.
      await agentTaskJobHandler.onSettled?.(makeSettled({ jobId: 'job-1', metadata: { manualRun: true } }))
      await agentTaskJobHandler.onSettled?.(makeSettled({ jobId: 'job-2' }))

      expect(runs().map((event) => event.run)).toEqual(['manual', 'scheduled'])
    })

    it('counts the recipients the run captured, not the subscriptions left at settlement', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValue([])

      await agentTaskJobHandler.onSettled?.(makeSettled({ metadata: { channelCount: 2 } }))

      expect(runs()).toMatchObject([{ channelCount: 2 }])
    })

    it('reports a stream the user stopped as cancelled rather than failed', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValue([])

      await agentTaskJobHandler.onSettled?.(makeSettled({ metadata: { taskResultStatus: 'cancelled' } }))

      expect(runs()).toMatchObject([{ result: 'cancelled' }])
    })

    it('flags autoPaused only on the failure that paused a still-enabled schedule', async () => {
      vi.mocked(jobService.listRecentTerminalByScheduleId).mockReturnValue(threeFailures())

      await agentTaskJobHandler.onSettled?.(makeSettled({ jobId: 'job-1' }))
      await agentTaskJobHandler.onSettled?.(makeSettled({ jobId: 'job-2' }))

      expect(runs().map((event) => [event.result, event.autoPaused])).toEqual([
        ['failed', true],
        ['failed', undefined]
      ])
    })

    it('stays silent for ad-hoc jobs without a schedule', async () => {
      await agentTaskJobHandler.onSettled?.(makeSettled({ scheduleId: null }))

      expect(runs()).toEqual([])
    })
  })
})
