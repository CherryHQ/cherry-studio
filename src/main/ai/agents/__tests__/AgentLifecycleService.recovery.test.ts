import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'

import { AgentJobsService } from '../AgentJobsService'
import { AgentLifecycleService } from '../AgentLifecycleService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PowerService: { preventSleep: () => ({ dispose() {} }) }
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

  it('runs healthy schedules after lifecycle reconciliation despite an early cleanup read failure', async () => {
    const orphan = seedSchedule('missing')
    const healthy = seedSchedule('active')
    const failure = vi.spyOn(jobScheduleService, 'listAll').mockImplementationOnce(() => {
      throw new Error('temporary read failure')
    })
    await agentJobs._doInit()
    failure.mockRestore()
    await lifecycle._doInit()
    expect(jobScheduleService.getById(orphan.id)).toBeNull()

    await jobs._doAllReady()
    await vi.advanceTimersByTimeAsync(61_001)

    expect(jobService.list({ scheduleId: healthy.id })).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(jobService.list({ scheduleId: orphan.id })).toEqual([])
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
