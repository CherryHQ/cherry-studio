/**
 * Integration tests for AgentJobsService — the sole command owner for agent
 * scheduled tasks. Runs against a real file-backed DB (production migrations)
 * with a real JobManager + SchedulerService so the properties under test are
 * the real ones: two-table atomicity, rollback leaving the timer untouched,
 * state-aware pause/resume no-ops, and trigger equality filtering.
 */

import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobScheduleRegistrationInput } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm } from '@shared/ipc/schemas/ai'

import type * as HeartbeatScheduleModule from '../heartbeatSchedule'

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

// The heartbeat sync is observed, not executed: these tests are about which
// service events reach it. Everything else in the module stays real so the
// deletion sweep under test is the production one.
const { syncHeartbeatScheduleMock, repairHeartbeatSchedulesMock } = vi.hoisted(() => ({
  // Both are awaited/chained by the service, so they must return promises.
  syncHeartbeatScheduleMock: vi.fn(async () => undefined),
  repairHeartbeatSchedulesMock: vi.fn(async () => undefined)
}))
vi.mock('../heartbeatSchedule', async (importOriginal) => {
  const actual = await importOriginal<typeof HeartbeatScheduleModule>()
  return {
    ...actual,
    syncHeartbeatSchedule: syncHeartbeatScheduleMock,
    repairHeartbeatSchedules: repairHeartbeatSchedulesMock
  }
})

// The real handler pulls in the whole runAgentTask execution chain; the
// service under test only needs SOME registered handler for 'agent.task'.
vi.mock('../runAgentTask', () => ({ runAgentTask: vi.fn(async () => ({})) }))

import { AgentJobsService } from '../AgentJobsService'
import { AgentLifecycleService } from '../AgentLifecycleService'

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
  let lifecycle: AgentLifecycleService

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
    lifecycle = new AgentLifecycleService()

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
        case 'AgentJobsService':
          return service
        case 'AiStreamManager':
          return {
            isWriteQuiesced: false,
            withDispatchLock: (_id: string, fn: () => unknown) => fn(),
            hasUnsettledTopicWork: () => false,
            pauseRuntimeTurn: () => {},
            abortAndDrain: async () => {}
          }
        case 'AgentSessionRuntimeService':
          return {
            isSessionBusy: () => false,
            closeSession: async () => {},
            cancelSessionForks: async () => {},
            recoverSessionForks: async () => {}
          }
        case 'AgentSessionDeliveryService':
          return { kick: () => {}, drainSessionQueues: async () => {}, pause: () => ({ dispose() {} }) }
        case 'ChannelManager':
          return { reconcileAgent: () => {} }
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
    // The service owns the in-flight drain and the agent-event subscriptions;
    // stopping only JobManager/SchedulerService would leave both behind.
    await service._doStop()
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  beforeEach(() => {
    clearScheduleDisposables()
    syncHeartbeatScheduleMock.mockClear()
    seedAgent(AGENT_ID)
  })

  // ---------------------------------------------------------------- create

  it('rolls back the Agent, Sessions and schedules together when archive or restore fails', async () => {
    const task = service.createTask(AGENT_ID, form)
    const session = agentSessionService.create({ agentId: AGENT_ID, name: 'Owned', workspace: { type: 'system' } })
    const fail = vi.spyOn(agentTaskService, 'setOwnerStateTx').mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    await expect(lifecycle.archiveAgent(AGENT_ID, { archiveSessions: true })).rejects.toThrow('write failed')
    expect(dbh.db.select().from(agentTable).get()?.deletedAt).toBeNull()
    expect(agentSessionService.getById(session.id).id).toBe(session.id)
    expect(jobScheduleService.getById(task.id)?.enabled).toBe(true)
    expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
    fail.mockRestore()

    await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: false })
    const failRestore = vi.spyOn(agentTaskService, 'setOwnerStateTx').mockImplementationOnce(() => {
      throw new Error('restore failed')
    })
    await expect(lifecycle.restoreAgent(AGENT_ID)).rejects.toThrow('restore failed')
    expect(dbh.db.select().from(agentTable).get()?.deletedAt).not.toBeNull()
    expect(jobScheduleService.getById(task.id)?.enabled).toBe(false)
    expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
    failRestore.mockRestore()
  })

  it('discards archived occurrences and only rearms future cron, interval and once triggers', async () => {
    vi.useFakeTimers()
    try {
      const tasks = [
        service.createTask(AGENT_ID, form),
        service.createTask(AGENT_ID, { ...form, name: 'cron', trigger: { kind: 'cron', expr: '* * * * *' } }),
        service.createTask(AGENT_ID, { ...form, name: 'future', trigger: { kind: 'once', at: Date.now() + 3_600_000 } })
      ]
      await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: true })
      await vi.advanceTimersByTimeAsync(180_000)
      for (const task of tasks) {
        expect(jobService.list({ scheduleId: task.id })).toEqual([])
        expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
      }
      await lifecycle.restoreAgent(AGENT_ID)
      for (const task of tasks) {
        expect(jobService.list({ scheduleId: task.id })).toEqual([])
        expect(Date.parse(jobScheduleService.getById(task.id)!.nextRun!)).toBeGreaterThan(Date.now())
      }
    } finally {
      clearScheduleDisposables()
      vi.useRealTimers()
    }
  })

  it('keeps an overdue once missed until a deduplicated explicit run completes', async () => {
    vi.useFakeTimers()
    try {
      const task = service.createTask(AGENT_ID, { ...form, trigger: { kind: 'once', at: Date.now() + 60_000 } })
      await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: false })
      await vi.advanceTimersByTimeAsync(120_000)
      await lifecycle.restoreAgent(AGENT_ID)
      expect(agentTaskService.getTask(AGENT_ID, task.id)).toMatchObject({ status: 'missed', enabled: false })
      expect(service.resumeTask(AGENT_ID, task.id)?.status).toBe('missed')
      expect(jobService.list({ scheduleId: task.id })).toEqual([])
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)

      const hold = jobManager.pause('test manual admission')
      await Promise.all([service.runTask(AGENT_ID, task.id), service.runTask(AGENT_ID, task.id)])
      expect(jobService.list({ scheduleId: task.id })).toHaveLength(1)
      expect(agentTaskService.getTask(AGENT_ID, task.id)?.status).toBe('missed')
      hold.dispose()
      await vi.waitFor(() => expect(agentTaskService.getTask(AGENT_ID, task.id)?.status).toBe('completed'))
      expect(jobScheduleService.getById(task.id)?.metadata).not.toHaveProperty('missed')
    } finally {
      clearScheduleDisposables()
      vi.useRealTimers()
    }
  })

  it('clears missed state on rescheduling but requires explicit enable and preserves reuse metadata', async () => {
    const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
    const metadata = jobScheduleService.getById(task.id)!.metadata
    jobScheduleService.update(task.id, {
      enabled: false,
      metadata: { ...metadata, missed: { reason: 'agent_archived', at: Date.now() } }
    })
    jobManager.syncJobScheduleTimerById(task.id)
    const updated = service.updateTask(AGENT_ID, task.id, { trigger: { kind: 'once', at: Date.now() + 60_000 } })
    expect(updated).toMatchObject({ status: 'paused', enabled: false, reuseSession: true })
    expect(jobScheduleService.getById(task.id)?.metadata).toEqual(metadata)
    expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
  })

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

    it('refuses a trashed Agent before any write', () => {
      // Registering first would arm the schedule and only then fail the
      // post-commit read, stranding an enabled row behind the error.
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

      expect(() => service.createTask(AGENT_ID, form)).toThrow('Agent not found')
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    })

    it('rejects a prompt that only trims to the heartbeat sentinel', () => {
      // The sweep's tolerant identity reads a padded sentinel as a heartbeat
      // row, so an ordinary task carrying one would lose its workspace.
      expect(() => service.createTask(AGENT_ID, { ...form, prompt: '  __heartbeat__  ' })).toThrow(
        'reserved for the agent heartbeat'
      )
      const task = service.createTask(AGENT_ID, form)
      expect(() => service.updateTask(AGENT_ID, task.id, { prompt: ' __heartbeat__ ' })).toThrow(
        'reserved for the agent heartbeat'
      )
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

    it('refuses the reserved heartbeat schedule name — nothing is written', () => {
      expect(() => service.createTask(AGENT_ID, { ...form, name: `heartbeat_${AGENT_ID}` })).toThrow(
        'reserved for the agent heartbeat'
      )
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    })

    it("refuses another agent's reserved heartbeat schedule name — the UNIQUE index is per type, not per agent", () => {
      seedAgent(OTHER_AGENT_ID)
      expect(() => service.createTask(AGENT_ID, { ...form, name: `heartbeat_${OTHER_AGENT_ID}` })).toThrow(
        'reserved for the agent heartbeat'
      )
      expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    })

    it('allows a heartbeat_-prefixed name that is not a live agent’s reserved name', () => {
      const task = service.createTask(AGENT_ID, { ...form, name: 'heartbeat_daily' })

      expect(task.name).toBe('heartbeat_daily')
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

    it('refuses to rename an existing task onto the reserved heartbeat name', () => {
      const task = service.createTask(AGENT_ID, form)

      expect(() => service.updateTask(AGENT_ID, task.id, { name: `heartbeat_${AGENT_ID}` })).toThrow(
        'reserved for the agent heartbeat'
      )
      expect(jobScheduleService.getById(task.id)?.name).toBe(form.name)
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

    it('deletes every Agent task through JobManager while preserving other agents tasks', async () => {
      seedAgent(OTHER_AGENT_ID)
      const own = service.createTask(AGENT_ID, form)
      const second = service.createTask(AGENT_ID, { ...form, name: 'hourly-rollup' })
      const foreign = service.createTask(OTHER_AGENT_ID, { ...form, name: 'foreign-task' })

      await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: false })
      expect((await lifecycle.purgeAgent(AGENT_ID)).deleted).toBe(true)

      expect(jobScheduleService.getById(own.id)).toBeNull()
      expect(jobScheduleService.getById(second.id)).toBeNull()
      // other agents' schedules are untouched
      expect(jobScheduleService.getById(foreign.id)).not.toBeNull()
      expect(scheduler.has(`schedule:${own.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${second.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${foreign.id}`)).toBe(true)
    })

    it('sweep removes a malformed-template row whose raw agentId still claims ownership', async () => {
      // Ownership is the raw template agentId — the same contract the startup
      // reaper reads. Requiring the full template parse here would strand a
      // bad-workspace row armed on a deleted agent until the next restart.
      seedAgent(OTHER_AGENT_ID)
      const own = service.createTask(AGENT_ID, form)
      const malformed = jobManager.registerJobSchedule({
        type: 'agent.task',
        name: 'task_malformed_template',
        trigger: intervalTrigger,
        // Deliberately violates the agent.task contract: no workspace/timeout/reuseRevision.
        jobInputTemplate: { agentId: AGENT_ID, prompt: 'orphan me' } as never,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(2)

      expect(jobScheduleService.getById(own.id)).toBeNull()
      expect(jobScheduleService.getById(malformed.id)).toBeNull()
    })

    it('continues the sweep when one schedule fails to unregister (transient failure)', async () => {
      // A transient unregister failure (SQLITE_BUSY, timer teardown) must not
      // abort the whole pass: the remaining schedules and the heartbeat
      // workspace cleanup are independent of the failed row.
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-busy',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-busy',
          type: 'user',
          orderKey: 'ws-hb-busy'
        })
        .run()
      const first = service.createTask(AGENT_ID, form)
      const second = service.createTask(AGENT_ID, { ...form, name: 'hourly-rollup' })
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-busy' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const spy = vi.spyOn(jobManager, 'unregisterJobScheduleById')
      spy.mockImplementationOnce(async () => {
        throw new Error('SQLITE_BUSY')
      })
      try {
        expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(2)
      } finally {
        spy.mockRestore()
      }

      // The failed row survives but is paused, so it cannot sit armed (and be
      // re-armed after every restart) firing for a dead agent.
      const survived = jobScheduleService.getById(first.id)
      expect(survived).not.toBeNull()
      expect(survived?.enabled).toBe(false)
      expect(jobScheduleService.getById(second.id)).toBeNull()
      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual([])
    })

    it('deleting an agent also removes the heartbeat workspace row its schedule referenced', async () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-1',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-agent-1',
          type: 'user',
          orderKey: 'ws-hb-1'
        })
        .run()
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'ws-user-1', name: 'My workspace', path: '/tmp/user-ws', type: 'user', orderKey: 'ws-user-1' })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-1' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      // Only the heartbeat workspace goes; an unrelated user workspace stays.
      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['ws-user-1'])
    })

    it('also removes the heartbeat workspace of a whitespace-corrupted sentinel row (deletion identity matches repair)', async () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-corr',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-corr',
          type: 'user',
          orderKey: 'ws-hb-corr'
        })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}__disambig0a`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '  __heartbeat__  ',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-corr' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    })

    it('also removes the workspace of a heartbeat row the v1 migration renamed (exact sentinel, non-reserved name)', async () => {
      // #19568 renames all but the first v1 `heartbeat` to `task_<v1Id>`, and
      // sync repairs such a row in place under its migrated name — the reserved
      // name shapes alone would strand its workspace on agent deletion.
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-v1renamed',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-v1renamed',
          type: 'user',
          orderKey: 'ws-hb-v1renamed'
        })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: 'task_v1-7',
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-v1renamed' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
    })

    it('keeps the workspace of an ordinary task whose padded-sentinel prompt sits outside the reserved names', async () => {
      // createTask blocks new padded-sentinel prompts; a row from before that
      // guard (or a manual write) must not have its user workspace swept.
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-task-padded',
          name: 'My task workspace',
          path: '/tmp/task-ws-padded',
          type: 'user',
          orderKey: 'ws-task-padded'
        })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: 'daily-report',
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '  __heartbeat__  ',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-task-padded' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['ws-task-padded'])
    })

    it('keeps a heartbeat workspace row that still has a session bound (no cascade)', async () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-shared',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-shared',
          type: 'user',
          orderKey: 'ws-hb-shared'
        })
        .run()
      // A session bound to the row — deleting the workspace would cascade it
      // away (agent_session.workspaceId is ON DELETE CASCADE).
      dbh.db
        .insert(agentSessionTable)
        .values({ id: 'sess-1', name: 'kept session', workspaceId: 'ws-hb-shared', orderKey: 'sess-1' })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-shared' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      // The schedule goes, but the referenced workspace row AND its session stay.
      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['ws-hb-shared'])
      expect(
        dbh.db
          .select()
          .from(agentSessionTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['sess-1'])
    })

    it("keeps a heartbeat workspace row referenced by another agent's task schedule", async () => {
      seedAgent(OTHER_AGENT_ID)
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-shared',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-shared',
          type: 'user',
          orderKey: 'ws-hb-shared'
        })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-shared' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      // Another agent's task pointing at the same row: deleting the row would
      // leave this template's workspaceId dangling.
      const foreign = service.createTask(OTHER_AGENT_ID, {
        ...form,
        name: 'foreign-on-shared-ws',
        workspace: { type: 'user', workspaceId: 'ws-hb-shared' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['ws-hb-shared'])
      expect(jobScheduleService.getById(foreign.id)).not.toBeNull()
    })

    it('keeps a heartbeat workspace row referenced by a channel', async () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'ws-hb-shared',
          name: 'Heartbeat — Agent agent-1',
          path: '/tmp/hb-ws-shared',
          type: 'user',
          orderKey: 'ws-hb-shared'
        })
        .run()
      dbh.db
        .insert(agentChannelTable)
        .values({
          id: CHANNEL_ID,
          type: 'telegram',
          name: 'ch on shared ws',
          agentId: AGENT_ID,
          workspace: { type: 'user', workspaceId: 'ws-hb-shared' },
          config: {}
        })
        .run()
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name: `heartbeat_${AGENT_ID}`,
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: '__heartbeat__',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: 'ws-hb-shared' },
          reuseRevision: 0
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await service.deleteSchedulesForAgent(AGENT_ID)).toBe(1)

      expect(
        dbh.db
          .select()
          .from(agentWorkspaceTable)
          .all()
          .map((row) => row.id)
      ).toEqual(['ws-hb-shared'])
      // The channel's workspace reference is untouched.
      expect(dbh.db.select().from(agentChannelTable).all()[0]?.workspace).toEqual({
        type: 'user',
        workspaceId: 'ws-hb-shared'
      })
    })

    it('reconciles trashed, restored, and missing Agent schedules without deleting retained tasks', async () => {
      seedAgent(OTHER_AGENT_ID)
      seedAgent('agent-active')
      const trashed = service.createTask(AGENT_ID, form)
      const missing = service.createTask(OTHER_AGENT_ID, { ...form, name: 'missing-agent-task' })
      const restored = service.createTask('agent-active', { ...form, name: 'restored-agent-task' })
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()
      dbh.db.delete(agentTable).where(eq(agentTable.id, OTHER_AGENT_ID)).run()
      jobScheduleService.update(restored.id, {
        enabled: false,
        metadata: { ...jobScheduleService.getById(restored.id)?.metadata, agentTrash: { resumeOnRestore: true } }
      })
      jobManager.syncJobScheduleTimerById(restored.id)
      notifyDataApiDataChangeMock.mockClear()

      expect(await lifecycle.reconcile()).toBe(3)

      expect(jobScheduleService.getById(trashed.id)).toMatchObject({
        enabled: false,
        metadata: { agentTrash: { resumeOnRestore: true } }
      })
      expect(jobScheduleService.getById(missing.id)).toBeNull()
      expect(jobScheduleService.getById(restored.id)).toMatchObject({ enabled: true })
      expect(jobScheduleService.getById(restored.id)?.metadata).not.toHaveProperty('agentTrash')
      expect(scheduler.has(`schedule:${trashed.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${missing.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${restored.id}`)).toBe(true)
    })

    it('trashing preserves task configuration and subscriptions, then restores only tasks that were enabled', async () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const enabledTask = service.createTask(AGENT_ID, {
        ...form,
        channelIds: [CHANNEL_ID],
        reuseSession: true
      })
      const pausedTask = service.createTask(AGENT_ID, {
        ...form,
        name: 'manually-paused',
        channelIds: [CHANNEL_ID]
      })
      await service.pauseTask(AGENT_ID, pausedTask.id)
      const enabledBeforeTrash = jobScheduleService.getById(enabledTask.id)
      const pausedBeforeTrash = jobScheduleService.getById(pausedTask.id)

      notifyDataApiDataChangeMock.mockClear()
      expect((await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: true })).deleted).toBe(true)

      expect(jobScheduleService.getById(enabledTask.id)).toMatchObject({
        name: enabledBeforeTrash?.name,
        trigger: enabledBeforeTrash?.trigger,
        jobInputTemplate: enabledBeforeTrash?.jobInputTemplate,
        catchUpPolicy: enabledBeforeTrash?.catchUpPolicy,
        enabled: false,
        metadata: {
          ...enabledBeforeTrash?.metadata,
          agentTrash: { resumeOnRestore: true }
        }
      })
      expect(jobScheduleService.getById(pausedTask.id)).toMatchObject({
        name: pausedBeforeTrash?.name,
        trigger: pausedBeforeTrash?.trigger,
        jobInputTemplate: pausedBeforeTrash?.jobInputTemplate,
        catchUpPolicy: pausedBeforeTrash?.catchUpPolicy,
        enabled: false,
        metadata: pausedBeforeTrash?.metadata
      })
      expect(jobScheduleService.getById(pausedTask.id)?.metadata).not.toHaveProperty('agentTrash')
      expect(subscriptionRows(enabledTask.id)).toEqual([{ channelId: CHANNEL_ID, taskId: enabledTask.id }])
      expect(subscriptionRows(pausedTask.id)).toEqual([{ channelId: CHANNEL_ID, taskId: pausedTask.id }])
      expect(scheduler.has(`schedule:${enabledTask.id}`)).toBe(false)
      expect(scheduler.has(`schedule:${pausedTask.id}`)).toBe(false)
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-tasks', kind: 'membership', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agents/:agentId/tasks', kind: 'membership', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agent-tasks/:taskId', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agents/:agentId/tasks/:taskId', entityIds: [enabledTask.id, pausedTask.id] }
      ])

      notifyDataApiDataChangeMock.mockClear()
      await lifecycle.restoreAgent(AGENT_ID)

      expect(jobScheduleService.getById(enabledTask.id)).toMatchObject({
        enabled: true,
        metadata: enabledBeforeTrash?.metadata
      })
      expect(jobScheduleService.getById(enabledTask.id)?.metadata).not.toHaveProperty('agentTrash')
      expect(jobScheduleService.getById(pausedTask.id)).toMatchObject({
        enabled: false,
        metadata: pausedBeforeTrash?.metadata
      })
      expect(subscriptionRows(enabledTask.id)).toEqual([{ channelId: CHANNEL_ID, taskId: enabledTask.id }])
      expect(subscriptionRows(pausedTask.id)).toEqual([{ channelId: CHANNEL_ID, taskId: pausedTask.id }])
      expect(scheduler.has(`schedule:${enabledTask.id}`)).toBe(true)
      expect(scheduler.has(`schedule:${pausedTask.id}`)).toBe(false)
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-tasks', kind: 'membership', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agents/:agentId/tasks', kind: 'membership', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agent-tasks/:taskId', entityIds: [enabledTask.id, pausedTask.id] },
        { endpoint: '/agents/:agentId/tasks/:taskId', entityIds: [enabledTask.id, pausedTask.id] }
      ])
    })

    it('detaches a sticky task session trashed with its Agent', async () => {
      const task = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      const session = agentSessionService.create({
        agentId: AGENT_ID,
        name: 'Scheduled task',
        workspace: { type: 'system' }
      })
      expect(
        service.bindTaskSessionReuse({
          scheduleId: task.id,
          sessionId: session.id,
          agentId: AGENT_ID,
          workspace: { type: 'system' },
          reuseRevision: 0
        })
      ).toBe(true)
      expect(agentTaskService.getTask(AGENT_ID, task.id)?.reuseSessionId).toBe(session.id)

      expect((await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: true })).deleted).toBe(true)
      await lifecycle.restoreAgent(AGENT_ID)

      expect(agentTaskService.getTask(AGENT_ID, task.id)?.reuseSessionId).toBeNull()
      expect(
        dbh.db
          .select({ taskScheduleId: agentSessionTable.taskScheduleId })
          .from(agentSessionTable)
          .where(eq(agentSessionTable.id, session.id))
          .get()
      ).toEqual({ taskScheduleId: null })
    })

    it('trashing and restoring also preserves a legacy task whose template has no workspace', async () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const task = jobManager.registerJobSchedule({
        type: 'agent.task',
        name: 'legacy-task-without-workspace',
        trigger: intervalTrigger,
        jobInputTemplate: {
          agentId: AGENT_ID,
          prompt: form.prompt,
          reuseRevision: 0,
          timeoutMinutes: form.timeoutMinutes
        } as JobScheduleRegistrationInput<'agent.task'>['jobInputTemplate'],
        catchUpPolicy: { kind: 'skip-missed' }
      })
      dbh.db.insert(agentChannelTaskTable).values({ channelId: CHANNEL_ID, taskId: task.id }).run()

      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
      expect(subscriptionRows(task.id)).toEqual([{ channelId: CHANNEL_ID, taskId: task.id }])

      expect((await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: true })).deleted).toBe(true)

      expect(jobScheduleService.getById(task.id)).toMatchObject({
        enabled: false,
        metadata: { agentTrash: { resumeOnRestore: true } }
      })
      expect(subscriptionRows(task.id)).toEqual([{ channelId: CHANNEL_ID, taskId: task.id }])
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)

      await lifecycle.restoreAgent(AGENT_ID)

      expect(jobScheduleService.getById(task.id)).toMatchObject({ enabled: true })
      expect(jobScheduleService.getById(task.id)?.metadata).not.toHaveProperty('agentTrash')
      expect(subscriptionRows(task.id)).toEqual([{ channelId: CHANNEL_ID, taskId: task.id }])
      expect(scheduler.has(`schedule:${task.id}`)).toBe(true)
    })

    it('permanent deletion cleans up a task left behind when trash event handling was interrupted', async () => {
      const task = service.createTask(AGENT_ID, form)
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

      expect((await lifecycle.purgeAgent(AGENT_ID)).deleted).toBe(true)

      await vi.waitFor(() => expect(jobScheduleService.getById(task.id)).toBeNull())
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
    })

    it('retention purge deletes retained schedules and cascades their channel subscriptions', async () => {
      seedChannel(CHANNEL_ID, AGENT_ID)
      const task = service.createTask(AGENT_ID, { ...form, channelIds: [CHANNEL_ID] })
      await lifecycle.archiveAgent(AGENT_ID, { archiveSessions: false })
      expect(jobScheduleService.getById(task.id)).not.toBeNull()
      expect(subscriptionRows(task.id)).toHaveLength(1)

      await lifecycle.purgeExpiredAgents(Number.MAX_SAFE_INTEGER, 10)

      await vi.waitFor(() => expect(jobScheduleService.getById(task.id)).toBeNull())
      expect(subscriptionRows(task.id)).toHaveLength(0)
      expect(scheduler.has(`schedule:${task.id}`)).toBe(false)
    })

    it('rejects every by-id task command after its Agent becomes inactive', async () => {
      const enabledTask = service.createTask(AGENT_ID, { ...form, reuseSession: true })
      const pausedTask = service.createTask(AGENT_ID, { ...form, name: 'paused-task' })
      await service.pauseTask(AGENT_ID, pausedTask.id)
      const session = agentSessionService.create({
        agentId: AGENT_ID,
        name: 'Scheduled task',
        workspace: { type: 'system' }
      })
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

      expect(service.updateTask(AGENT_ID, enabledTask.id, { name: 'must-not-update' })).toBeNull()
      expect(await service.pauseTask(AGENT_ID, enabledTask.id)).toBeNull()
      expect(service.resumeTask(AGENT_ID, pausedTask.id)).toBeNull()
      expect(await service.runTask(AGENT_ID, enabledTask.id)).toBe(false)
      expect(await service.deleteTask(AGENT_ID, enabledTask.id)).toBe(false)
      expect(
        service.bindTaskSessionReuse({
          scheduleId: enabledTask.id,
          sessionId: session.id,
          agentId: AGENT_ID,
          workspace: { type: 'system' },
          reuseRevision: 0
        })
      ).toBe(false)

      expect(jobScheduleService.getById(enabledTask.id)).toMatchObject({ enabled: true, name: form.name })
      expect(jobScheduleService.getById(pausedTask.id)).toMatchObject({ enabled: false, name: 'paused-task' })
      expect(
        dbh.db
          .select({ taskScheduleId: agentSessionTable.taskScheduleId })
          .from(agentSessionTable)
          .where(eq(agentSessionTable.id, session.id))
          .get()
      ).toEqual({ taskScheduleId: null })
    })

    it('repairs archived owner schedules without enabling them', async () => {
      const task = service.createTask(AGENT_ID, form)
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()

      await lifecycle.reconcile()

      await vi.waitFor(() =>
        expect(jobScheduleService.getById(task.id)).toMatchObject({
          enabled: false,
          metadata: { agentTrash: { resumeOnRestore: true } }
        })
      )
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
