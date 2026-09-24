import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { IpcChannel } from '@shared/IpcChannel'

import { AgentJobsService } from '../AgentJobsService'
import { AgentLifecycleService } from '../AgentLifecycleService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PowerService: { preventSleep: () => ({ dispose() {} }) },
    AiStreamManager: { isWriteQuiesced: false }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('../runAgentTask', () => ({ runAgentTask: async () => ({}) }))

describe('Agent lifecycle startup reconciliation', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobs: JobManager
  let agentJobs: AgentJobsService
  let lifecycle: AgentLifecycleService

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.useFakeTimers()
    scheduler = new SchedulerService()
    jobs = new JobManager()
    agentJobs = new AgentJobsService()
    lifecycle = new AgentLifecycleService()
    const container = application.getContainer()
    vi.spyOn(application, 'get').mockImplementation((name) => {
      if (name === 'JobManager') return jobs
      if (name === 'SchedulerService') return scheduler
      return container.get(name)
    })
    await scheduler._doInit()
    await jobs._doInit()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'active',
        type: 'claude-code',
        name: 'Active',
        instructions: '',
        orderKey: 'a0'
      })
      .run()
  })

  afterEach(async () => {
    await lifecycle._doStop()
    await agentJobs._doStop()
    await jobs._doStop()
    await scheduler._doStop()
    vi.restoreAllMocks()
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  function seedSchedule(agentId: string, prompt = 'Run task', workspaceId?: string) {
    return jobScheduleService.create({
      type: 'agent.task',
      name: `task_${agentId}`,
      trigger: { kind: 'once', at: Date.now() + 61_000 },
      jobInputTemplate: {
        agentId,
        prompt,
        timeoutMinutes: 2,
        reuseRevision: 0,
        workspace: workspaceId ? { type: 'user', workspaceId } : { type: 'system' }
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })
  }

  it('blocks orphan fires and retries failed cleanup while healthy schedules keep running', async () => {
    const orphan = seedSchedule('missing')
    const healthy = seedSchedule('active')
    const failure = vi.spyOn(agentTaskService, 'reconcileOwnerStatesTx').mockImplementation(() => {
      throw new Error('temporary cleanup failure')
    })
    await agentJobs._doInit()
    await expect(lifecycle._doInit()).rejects.toThrow('temporary cleanup failure')
    await jobs._doAllReady()
    await vi.advanceTimersByTimeAsync(61_001)

    expect(jobScheduleService.getById(orphan.id)).not.toBeNull()
    expect(jobService.list({ scheduleId: orphan.id })).toEqual([])
    expect(jobService.list({ scheduleId: healthy.id })).toEqual([expect.objectContaining({ status: 'completed' })])

    failure.mockRestore()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobScheduleService.getById(orphan.id)).toBeNull()
    expect(jobService.list({ scheduleId: orphan.id })).toEqual([])
    expect(scheduler.has(`schedule:${orphan.id}`)).toBe(false)
  })

  it.each([false, true])(
    'publishes committed workspace deletion on restart (cleanup fails first: %s)',
    async (failsFirst) => {
      await agentJobs._doInit()
      await lifecycle._doInit()
      await lifecycle._doStop()
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'restart-workspace',
          type: 'user',
          name: 'Heartbeat',
          path: '/tmp/restart-owner',
          orderKey: 'a0'
        })
        .run()
      const orphan = seedSchedule('missing', '__heartbeat__', 'restart-workspace')
      vi.spyOn(application, 'isReady').mockReturnValue(true)
      const observations: boolean[] = []
      vi.spyOn(application.get('WindowManager'), 'broadcast').mockImplementation((channel, effects) => {
        if (channel !== IpcChannel.DataApi_DataChanged) return
        if ((effects as Array<{ endpoint: string }>).some((effect) => effect.endpoint === '/agent-workspaces')) {
          observations.push(!dbh.sqlite.inTransaction && dbh.db.select().from(agentWorkspaceTable).all().length === 0)
        }
      })
      if (failsFirst) {
        const failure = vi.spyOn(agentWorkspaceService, 'deleteIfUnreferencedTx').mockImplementationOnce(() => {
          throw new Error('workspace busy')
        })
        await expect(lifecycle._doInit()).rejects.toThrow('workspace busy')
        expect(jobScheduleService.getById(orphan.id)).not.toBeNull()
        expect(observations).toEqual([])
        failure.mockRestore()
        await vi.advanceTimersByTimeAsync(30_000)
      } else {
        await lifecycle._doInit()
      }
      expect(jobScheduleService.getById(orphan.id)).toBeNull()
      expect(observations).toEqual([true])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(observations).toEqual([true])
    }
  )

  it.each([30_000, 90_000])(
    'restores timer ownership after a startup retry at %s ms without bypassing the quiet window',
    async (recoveredAt) => {
      const task = seedSchedule('active')
      jobScheduleService.update(task.id, {
        trigger: { kind: 'once', at: Date.now() + 120_000 },
        enabled: false,
        metadata: { agentTrash: { resumeOnRestore: true } }
      })
      const failure = vi.spyOn(agentTaskService, 'reconcileOwnerStatesTx').mockImplementation(() => {
        throw new Error('cleanup unavailable')
      })
      await agentJobs._doInit()
      await expect(lifecycle._doInit()).rejects.toThrow('cleanup unavailable')
      await jobs._doAllReady()
      await vi.advanceTimersByTimeAsync(recoveredAt - 1)
      failure.mockRestore()
      await vi.advanceTimersByTimeAsync(1)
      expect(jobScheduleService.getById(task.id)?.enabled).toBe(true)
      if (recoveredAt < 60_000) {
        expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
        expect(jobService.list({ scheduleId: task.id })).toEqual([])
      }
      await vi.advanceTimersByTimeAsync(120_001 - recoveredAt)
      expect(jobService.list({ scheduleId: task.id })).toEqual([expect.objectContaining({ status: 'completed' })])
    }
  )

  it('stops reconciliation retries with the service', async () => {
    const orphan = seedSchedule('missing')
    const failure = vi.spyOn(agentTaskService, 'reconcileOwnerStatesTx').mockImplementationOnce(() => {
      throw new Error('cleanup unavailable')
    })
    await expect(lifecycle._doInit()).rejects.toThrow('cleanup unavailable')
    await lifecycle._doStop()
    failure.mockRestore()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobScheduleService.getById(orphan.id)).not.toBeNull()
  })

  it('reclaims an orphan heartbeat workspace in the existing lifecycle reconciliation', async () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'heartbeat-workspace',
        type: 'user',
        name: 'Heartbeat',
        path: '/tmp/heartbeat-owner',
        orderKey: 'a0'
      })
      .run()
    const orphan = seedSchedule('missing', '__heartbeat__', 'heartbeat-workspace')

    await lifecycle._doInit()

    expect(jobScheduleService.getById(orphan.id)).toBeNull()
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
  })
})
