/**
 * Integration tests for AgentJobsService — the sole command owner for agent
 * scheduled tasks. Runs against a real file-backed DB (production migrations)
 * with a real JobManager + SchedulerService so the properties under test are
 * the real ones: two-table atomicity, rollback leaving the timer untouched,
 * state-aware pause/resume no-ops, and trigger equality filtering.
 */

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm } from '@shared/ipc/schemas/ai'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Registering a second schedule type exercises the type guard; the dummy
// entry is compile-time only and never enters production code.
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'dummy.other': Record<string, unknown>
  }
}

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

// The real handler pulls in the whole runAgentTask execution chain; the
// service under test only needs SOME registered handler for 'agent.task'.
vi.mock('../agentTaskJobHandler', () => ({
  agentTaskJobHandler: {
    recovery: 'abandon',
    defaultConcurrency: 1,
    async execute() {
      return {}
    }
  } satisfies JobHandler
}))

import { AgentJobsService } from '../AgentJobsService'

const AGENT_ID = 'agent-1'
const OTHER_AGENT_ID = 'agent-2'
const CHANNEL_ID = 'channel-1'

const intervalTrigger: Trigger = { kind: 'interval', ms: 60_000 }
const form: AgentTaskForm = {
  name: 'daily-report',
  prompt: 'Summarise yesterday',
  trigger: intervalTrigger,
  workspace: { type: 'system' },
  timeoutMinutes: 5
}

describe('AgentJobsService', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobManager: JobManager
  let service: AgentJobsService

  function seedAgent(id: string): void {
    dbh.db
      .insert(agentTable)
      .values({ id, type: 'claude-code', name: `Agent ${id}`, instructions: '', orderKey: id })
      .run()
  }

  function seedChannel(id: string, agentId: string | null): void {
    dbh.db
      .insert(agentChannelTable)
      .values({ id, type: 'telegram', name: `ch ${id}`, agentId, workspace: { type: 'system' }, config: {} })
      .run()
  }

  function subscriptionRows(taskId: string): { channelId: string; taskId: string }[] {
    return dbh.db
      .select()
      .from(agentChannelTaskTable)
      .all()
      .filter((r) => r.taskId === taskId)
  }

  function getIntervalEntry(scheduleId: string): unknown {
    const handles = (scheduler as unknown as { intervalHandles: Map<string, unknown> }).intervalHandles
    return handles.get(`schedule:${scheduleId}`)
  }

  function clearScheduleDisposables(): void {
    const map = (jobManager as unknown as { scheduleDisposables: Map<string, { dispose: () => void }> })
      .scheduleDisposables
    for (const disp of map.values()) disp.dispose()
    map.clear()
  }

  beforeAll(async () => {
    BaseService.resetInstances()
    scheduler = new SchedulerService()
    jobManager = new JobManager()
    service = new AgentJobsService()

    const dbSvc = MockMainDbServiceExport.dbService
    // The default mock withWriteTx passes the bare db through with no BEGIN /
    // ROLLBACK — atomicity tests need the real thing.
    dbSvc.withWriteTx.mockImplementation(<T>(fn: (tx: unknown) => T): T => dbh.db.transaction((tx) => fn(tx)))
    const cacheSvc = MockMainCacheServiceExport.cacheService
    ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      switch (name) {
        case 'DbService':
          return dbSvc
        case 'CacheService':
          return cacheSvc
        case 'SchedulerService':
          return scheduler
        case 'JobManager':
          return jobManager
        case 'PowerService':
          return { preventSleep: () => ({ dispose: () => {} }) }
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })

    await scheduler._doInit()
    await jobManager._doInit()
    await service._doInit() // registers the (mocked) 'agent.task' handler
    jobManager.registerHandler('dummy.other', {
      recovery: 'abandon',
      async execute() {
        return {}
      }
    })
  })

  afterAll(async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  beforeEach(() => {
    clearScheduleDisposables()
    seedAgent(AGENT_ID)
  })

  // ---------------------------------------------------------------- create

  describe('createTask', () => {
    it('persists the schedule + subscriptions in one transaction and arms the timer after commit', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)

      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })

      expect(task).toMatchObject({ agentId: AGENT_ID, name: form.name, enabled: true, channelIds: [CHANNEL_ID] })
      expect(jobScheduleService.getById(task.id)).toMatchObject({ type: 'agent.task', enabled: true })
      expect(subscriptionRows(task.id)).toHaveLength(1)
      // Anti-regression for the two-step design: forgetting the post-commit
      // sync would leave a committed row with no timer.
      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
    })

    it('validates the agent before any write', () => {
      expect(() => service.createTask('missing-agent', form)).toThrow('Agent not found')
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    })

    it('rejects a foreign channel before any write', () => {
      seedAgent(OTHER_AGENT_ID)
      seedChannel('foreign-channel', OTHER_AGENT_ID)

      expect(() => service.createTask(AGENT_ID, { ...form, channelIds: ['foreign-channel'] })).toThrow(
        'Channel not found'
      )
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    })

    it('rolls back the schedule row when the subscription write fails — no row, no timer', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const spy = vi.spyOn(agentChannelService, 'replaceTaskSubscriptionsTx').mockImplementationOnce(() => {
        throw new Error('subscription write failed')
      })

      expect(() => service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })).toThrow(
        'subscription write failed'
      )

      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
      expect(dbh.db.select().from(agentChannelTaskTable).all()).toHaveLength(0)
      const disposables = (jobManager as unknown as { scheduleDisposables: Map<string, unknown> }).scheduleDisposables
      expect(disposables.size).toBe(0)
      spy.mockRestore()
    })

    it('rejects an invalid cron trigger up front — no row, no subscriptions, no timer', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)

      expect(() =>
        service.createTask(AGENT_ID, {
          ...form,
          trigger: { kind: 'cron', expr: 'not a cron' },
          channelIds: [CHANNEL_ID]
        })
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)

      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
      expect(dbh.db.select().from(agentChannelTaskTable).all()).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------- update

  describe('updateTask', () => {
    it('rebuilds the job input template on a prompt change without touching the timer', () => {
      const task = service.createTask(AGENT_ID, form)
      const originalEntry = getIntervalEntry(task.id)

      const updated = service.updateTask(AGENT_ID, task.id, { prompt: 'new prompt' })

      expect(updated?.prompt).toBe('new prompt')
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ prompt: 'new prompt' })
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
    })

    it('drops a semantically-equal trigger from the patch — the interval phase is not reset', () => {
      const task = service.createTask(AGENT_ID, form)
      const originalEntry = getIntervalEntry(task.id)

      // Full-field save as the edit dialog submits it: fresh trigger object, same value.
      const updated = service.updateTask(AGENT_ID, task.id, {
        name: 'renamed',
        trigger: { kind: 'interval', ms: 60_000 }
      })

      expect(updated?.name).toBe('renamed')
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
    })

    it('re-arms the timer after commit when the trigger actually changed', () => {
      const task = service.createTask(AGENT_ID, form)
      const originalEntry = getIntervalEntry(task.id)

      const updated = service.updateTask(AGENT_ID, task.id, { trigger: { kind: 'interval', ms: 120_000 } })

      expect(updated?.trigger).toEqual({ kind: 'interval', ms: 120_000 })
      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
      expect(getIntervalEntry(task.id)).not.toBe(originalEntry)
    })

    it('updates subscriptions atomically with the schedule row', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })
      seedChannel('channel-2', AGENT_ID)

      const updated = service.updateTask(AGENT_ID, task.id, { channelIds: ['channel-2'] })

      expect(updated?.channelIds).toEqual(['channel-2'])
      expect(subscriptionRows(task.id)).toEqual([{ channelId: 'channel-2', taskId: task.id }])
    })

    it('a failed subscription replacement leaves row, subscriptions and timer all unchanged', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      seedChannel('channel-2', AGENT_ID)
      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })
      const originalEntry = getIntervalEntry(task.id)
      const spy = vi.spyOn(agentChannelService, 'replaceTaskSubscriptionsTx').mockImplementationOnce(() => {
        throw new Error('subscription write failed')
      })

      expect(() =>
        service.updateTask(AGENT_ID, task.id, {
          name: 'renamed',
          trigger: { kind: 'interval', ms: 120_000 },
          channelIds: ['channel-2']
        })
      ).toThrow('subscription write failed')

      const row = jobScheduleService.getById(task.id)
      expect(row?.name).toBe(form.name)
      expect(row?.trigger).toEqual(intervalTrigger)
      expect(subscriptionRows(task.id)).toEqual([{ channelId: CHANNEL_ID, taskId: task.id }])
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
      spy.mockRestore()
    })

    it('rejects an invalid trigger with the old row, subscriptions and timer intact', () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })
      const originalEntry = getIntervalEntry(task.id)

      expect(() =>
        service.updateTask(AGENT_ID, task.id, { trigger: { kind: 'cron', expr: '0 0 * * *', timezone: 'Not/AZone' } })
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)

      expect(jobScheduleService.getById(task.id)?.trigger).toEqual(intervalTrigger)
      expect(subscriptionRows(task.id)).toEqual([{ channelId: CHANNEL_ID, taskId: task.id }])
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
    })

    it('returns null for a schedule that is not an agent.task', () => {
      const foreign = jobManager.registerJobSchedule({
        type: 'dummy.other',
        trigger: intervalTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(service.updateTask(AGENT_ID, foreign.id, { name: 'hijack' })).toBeNull()
      expect(jobScheduleService.getById(foreign.id)?.name).toBeNull()
    })

    it("returns null for another agent's task", () => {
      seedAgent(OTHER_AGENT_ID)
      const task = service.createTask(OTHER_AGENT_ID, form)

      expect(service.updateTask(AGENT_ID, task.id, { name: 'hijack' })).toBeNull()
      expect(jobScheduleService.getById(task.id)?.name).toBe(form.name)
    })
  })

  // ---------------------------------------------------------------- pause / resume

  describe('pauseTask / resumeTask', () => {
    it('pause disables the row and disposes the timer; resume re-arms it', async () => {
      const task = service.createTask(AGENT_ID, form)
      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)

      const paused = await service.pauseTask(AGENT_ID, task.id)
      expect(paused?.enabled).toBe(false)
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)

      const resumed = service.resumeTask(AGENT_ID, task.id)
      expect(resumed?.enabled).toBe(true)
      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
    })

    it('a repeated pause is a state-aware no-op that never reaches the DB', async () => {
      const task = service.createTask(AGENT_ID, form)
      await service.pauseTask(AGENT_ID, task.id)
      const updatedAtAfterFirst = jobScheduleService.getById(task.id)?.updatedAt
      const setEnabledSpy = vi.spyOn(jobScheduleService, 'setEnabled')

      const again = await service.pauseTask(AGENT_ID, task.id)

      expect(again?.enabled).toBe(false)
      expect(setEnabledSpy).not.toHaveBeenCalled()
      expect(jobScheduleService.getById(task.id)?.updatedAt).toBe(updatedAtAfterFirst)
      setEnabledSpy.mockRestore()
    })

    it('a repeated resume neither re-registers the timer nor resets the interval phase', () => {
      const task = service.createTask(AGENT_ID, form)
      const originalEntry = getIntervalEntry(task.id)
      const updatedAtBefore = jobScheduleService.getById(task.id)?.updatedAt
      const registerSpy = vi.spyOn(scheduler, 'registerSchedule')

      const again = service.resumeTask(AGENT_ID, task.id)

      expect(again?.enabled).toBe(true)
      expect(registerSpy).not.toHaveBeenCalled()
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
      expect(jobScheduleService.getById(task.id)?.updatedAt).toBe(updatedAtBefore)
      registerSpy.mockRestore()
    })

    it('returns null for a non-agent.task schedule', async () => {
      const foreign = jobManager.registerJobSchedule({
        type: 'dummy.other',
        trigger: intervalTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.pauseTask(AGENT_ID, foreign.id)).toBeNull()
      expect(service.resumeTask(AGENT_ID, foreign.id)).toBeNull()
      expect(jobScheduleService.getById(foreign.id)?.enabled).toBe(true)
    })
  })

  // ---------------------------------------------------------------- delete / run

  describe('deleteTask / runTask', () => {
    it('delete removes the row, cascades the subscriptions, and disposes the timer', async () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })

      expect(await service.deleteTask(AGENT_ID, task.id)).toBe(true)

      expect(jobScheduleService.getById(task.id)).toBeNull()
      expect(subscriptionRows(task.id)).toHaveLength(0)
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
    })

    it('delete and run refuse non-agent.task schedules and foreign tasks', async () => {
      seedAgent(OTHER_AGENT_ID)
      const foreignType = jobManager.registerJobSchedule({
        type: 'dummy.other',
        trigger: intervalTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const foreignAgent = service.createTask(OTHER_AGENT_ID, form)

      expect(await service.deleteTask(AGENT_ID, foreignType.id)).toBe(false)
      expect(await service.deleteTask(AGENT_ID, foreignAgent.id)).toBe(false)
      expect(await service.runTask(AGENT_ID, foreignType.id)).toBe(false)
      expect(await service.runTask(AGENT_ID, foreignAgent.id)).toBe(false)

      expect(jobScheduleService.getById(foreignType.id)).not.toBeNull()
      expect(jobScheduleService.getById(foreignAgent.id)).not.toBeNull()
    })

    it('run fires an owned task', async () => {
      const task = service.createTask(AGENT_ID, form)
      expect(await service.runTask(AGENT_ID, task.id)).toBe(true)
    })
  })
})
