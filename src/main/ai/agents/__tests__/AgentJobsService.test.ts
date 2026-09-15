/**
 * Integration tests for AgentJobsService — the sole command owner for agent
 * scheduled tasks. Runs against a real file-backed DB (production migrations)
 * with a real JobManager + SchedulerService so the properties under test are
 * the real ones: two-table atomicity, rollback leaving the timer untouched,
 * state-aware pause/resume no-ops, and trigger equality filtering.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm } from '@shared/ipc/schemas/ai'

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

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

// The real handler pulls in the whole runAgentTask execution chain; the
// service under test only needs SOME registered handler for 'agent.task'.
vi.mock('../agentTaskJobHandler', () => ({
  agentTaskJobHandler: {
    recovery: 'retry',
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
    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
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

  beforeEach(() => {
    notifyDataApiDataChangeMock.mockClear()
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
    it('stores an explicitly empty timeout as unlimited', () => {
      const task = service.createTask(AGENT_ID, { ...form, timeoutMinutes: null })

      expect(task.timeoutMinutes).toBe(0)
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ timeoutMinutes: 0 })
    })

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

    it('refuses the reserved heartbeat prompt — nothing is written', () => {
      expect(() => service.createTask(AGENT_ID, { ...form, prompt: '__heartbeat__' })).toThrow(
        'reserved for the agent heartbeat'
      )
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
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
    it('updates an explicitly empty timeout to unlimited', () => {
      const task = service.createTask(AGENT_ID, form)

      const updated = service.updateTask(AGENT_ID, task.id, { timeoutMinutes: null })

      expect(updated?.timeoutMinutes).toBe(0)
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ timeoutMinutes: 0 })
    })

    it('rebuilds the job input template on a prompt change without touching the timer', () => {
      const task = service.createTask(AGENT_ID, form)
      const originalEntry = getIntervalEntry(task.id)

      const updated = service.updateTask(AGENT_ID, task.id, { prompt: 'new prompt' })

      expect(updated?.prompt).toBe('new prompt')
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ prompt: 'new prompt' })
      expect(getIntervalEntry(task.id)).toBe(originalEntry)
    })

    it('refuses to repoint an existing task at the reserved heartbeat prompt', () => {
      const task = service.createTask(AGENT_ID, form)

      expect(() => service.updateTask(AGENT_ID, task.id, { prompt: '__heartbeat__' })).toThrow(
        'reserved for the agent heartbeat'
      )
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ prompt: form.prompt })
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

  // ---------------------------------------------------------------- session reuse

  describe('session reuse', () => {
    /** Simulate a fire having bound its sticky session, plus an unrelated metadata key. */
    function bindSession(taskId: string): string {
      const session = agentSessionService.create({
        agentId: AGENT_ID,
        name: 'Scheduled task',
        workspace: { type: 'system' }
      })
      dbh.db.transaction((tx) =>
        agentSessionService.bindTaskScheduleTx(tx, {
          sessionId: session.id,
          taskScheduleId: taskId,
          expectedAgentId: AGENT_ID
        })
      )
      const current = jobScheduleService.getById(taskId)?.metadata ?? {}
      jobScheduleService.update(taskId, { metadata: { ...current, unrelated: 'keep-me' } })
      return session.id
    }

    function readReuse(taskId: string): unknown {
      return jobScheduleService.getById(taskId)?.metadata?.reuse
    }

    it('defaults to reuse off with nothing bound', () => {
      const task = service.createTask(AGENT_ID, form)

      expect(task.reuseSession).toBe(false)
      expect(task.reuseSessionId).toBeNull()
      expect(readReuse(task.id)).toEqual({ enabled: false, revision: 0 })
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ reuseRevision: 0 })
    })

    it('enables reuse without binding a session up front', () => {
      const task = service.createTask(AGENT_ID, form)

      const updated = service.updateTask(AGENT_ID, task.id, { reuseSession: true })

      expect(updated?.reuseSession).toBe(true)
      expect(updated?.reuseSessionId).toBeNull()
      expect(readReuse(task.id)).toEqual({ enabled: true, revision: 1 })
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ reuseRevision: 1 })
    })

    it('clears the bound session when reuse is turned off', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      const sessionId = bindSession(task.id)
      expect(service.updateTask(AGENT_ID, task.id, {})?.reuseSessionId).toBe(sessionId)

      const updated = service.updateTask(AGENT_ID, task.id, { reuseSession: false })

      expect(updated?.reuseSession).toBe(false)
      expect(updated?.reuseSessionId).toBeNull()
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-tasks', kind: 'projection', entityIds: [task.id] },
        { endpoint: '/agents/:agentId/tasks', kind: 'projection', entityIds: [task.id] },
        { endpoint: '/agent-tasks/:taskId', entityIds: [task.id] },
        { endpoint: '/agents/:agentId/tasks/:taskId', entityIds: [task.id] }
      ])
    })

    // A bound session keeps its own workspace, so without this the user would
    // repoint the task at workspace B and watch it keep working in A.
    it('clears the bound session when the workspace changes, keeping reuse on', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      bindSession(task.id)

      const updated = service.updateTask(AGENT_ID, task.id, {
        workspace: { type: 'user', workspaceId: 'ws-9' }
      })

      expect(updated?.reuseSession).toBe(true)
      expect(updated?.reuseSessionId).toBeNull()
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({
        workspace: { type: 'user', workspaceId: 'ws-9' }
      })
    })

    // The edit dialog submits full-field saves, so a no-op workspace resubmit
    // must not silently reset the conversation.
    it('keeps the bound session when the workspace is resubmitted unchanged', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      const sessionId = bindSession(task.id)

      const updated = service.updateTask(AGENT_ID, task.id, { workspace: { type: 'system' } })

      expect(updated?.reuseSessionId).toBe(sessionId)
    })

    // `updateTx` replaces the metadata column wholesale — the read-merge-write
    // in updateTask is what keeps foreign keys alive.
    it('preserves unrelated metadata keys when clearing the pointer', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      bindSession(task.id)

      service.updateTask(AGENT_ID, task.id, { reuseSession: false })

      expect(jobScheduleService.getById(task.id)?.metadata).toEqual({
        reuse: { enabled: false, revision: 1 },
        unrelated: 'keep-me'
      })
    })

    it('bumps the reuse revision only for reuse or effective workspace changes', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })

      service.updateTask(AGENT_ID, task.id, { name: 'renamed' })
      expect(readReuse(task.id)).toMatchObject({ revision: 0 })

      service.updateTask(AGENT_ID, task.id, { workspace: { type: 'user', workspaceId: 'ws-9' } })
      expect(readReuse(task.id)).toMatchObject({ enabled: true, revision: 1 })
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ reuseRevision: 1 })

      service.updateTask(AGENT_ID, task.id, { workspace: { type: 'user', workspaceId: 'ws-9' } })
      expect(readReuse(task.id)).toMatchObject({ revision: 1 })

      service.updateTask(AGENT_ID, task.id, { reuseSession: false })
      expect(readReuse(task.id)).toMatchObject({ enabled: false, revision: 2 })
      expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ reuseRevision: 2 })
    })

    it('binds only matching current reuse config and preserves unrelated metadata', () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      jobScheduleService.update(task.id, {
        metadata: { reuse: { enabled: true, revision: 0 }, unrelated: 'keep-me' }
      })

      const session = agentSessionService.create({
        agentId: AGENT_ID,
        name: 'Scheduled task',
        workspace: { type: 'system' }
      })
      notifyDataApiDataChangeMock.mockClear()

      expect(
        service.bindTaskSessionReuse({
          scheduleId: task.id,
          sessionId: session.id,
          agentId: AGENT_ID,
          workspace: { type: 'user', workspaceId: 'wrong' },
          reuseRevision: 0
        })
      ).toBe(false)
      expect(
        service.bindTaskSessionReuse({
          scheduleId: task.id,
          sessionId: session.id,
          agentId: AGENT_ID,
          workspace: { type: 'system' },
          reuseRevision: 1
        })
      ).toBe(false)

      expect(
        service.bindTaskSessionReuse({
          scheduleId: task.id,
          sessionId: session.id,
          agentId: AGENT_ID,
          workspace: { type: 'system' },
          reuseRevision: 0
        })
      ).toBe(true)
      expect(jobScheduleService.getById(task.id)?.metadata).toEqual({
        reuse: { enabled: true, revision: 0 },
        unrelated: 'keep-me'
      })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(1)
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

    it('deleting an agent removes its schedules and disposes their timers (orphan cleanup)', async () => {
      seedAgent(OTHER_AGENT_ID)
      const own = service.createTask(AGENT_ID, form)
      const second = service.createTask(AGENT_ID, { ...form, name: 'hourly-rollup' })
      const foreign = service.createTask(OTHER_AGENT_ID, { ...form, name: 'foreign-task' })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(2)

      expect(jobScheduleService.getById(own.id)).toBeNull()
      expect(jobScheduleService.getById(second.id)).toBeNull()
      // other agents' schedules are untouched
      expect(jobScheduleService.getById(foreign.id)).not.toBeNull()
      expect(scheduler.has(`schedule:${own.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${second.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${foreign.id}`)).toBe(true)
    })

    it('agent deletion fires the cleanup through onAgentDeleted', async () => {
      const task = service.createTask(AGENT_ID, form)

      // The full deleteAgent path needs the data-service registry (out of
      // scope here); fire the real emitter the subscription listens on.
      ;(
        agentService as unknown as { _onAgentDeleted: { fire: (e: { agentId: string }) => void } }
      )._onAgentDeleted.fire({ agentId: AGENT_ID })

      // The subscription is fire-and-forget; let the microtask queue drain.
      await vi.waitFor(() => expect(jobScheduleService.getById(task.id)).toBeNull())
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
