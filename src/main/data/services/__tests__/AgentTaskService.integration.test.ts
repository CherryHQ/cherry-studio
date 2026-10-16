import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentTaskRunTable } from '@data/db/schemas/agentTaskRun'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobTable } from '@data/db/schemas/job'
import { agentTaskRunService } from '@data/services/AgentTaskRunService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { AgentTaskDashboardService } from '@main/ai/agents/AgentTaskDashboardService'
import type { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { DASHBOARD_RETENTION_MS } from '@shared/data/api/schemas/agentTaskDashboard'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

describe('AgentTaskService active-Agent read contract', () => {
  const dbh = setupTestDatabase()

  function seedAgent(id: string, deletedAt: number | null = null): void {
    dbh.db
      .insert(agentTable)
      .values({ id, type: 'claude-code', name: id, instructions: '', orderKey: id, deletedAt })
      .run()
  }

  function seedTask(name: string, agentId: string): string {
    return jobScheduleService.create({
      type: 'agent.task',
      name,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {
        agentId,
        prompt: `Prompt for ${name}`,
        timeoutMinutes: 2,
        workspace: { type: 'system' }
      },
      catchUpPolicy: { kind: 'skip-missed' }
    }).id
  }

  it('hides tasks owned by trashed or missing Agents from every normal read and shows them after restore', () => {
    seedAgent('agent-active')
    seedAgent('agent-trashed', Date.now())
    const activeTaskId = seedTask('task-active', 'agent-active')
    const trashedTaskId = seedTask('task-trashed', 'agent-trashed')
    const missingTaskId = seedTask('task-missing', 'agent-missing')

    expect(agentTaskService.listAllTasks().tasks.map((task) => task.id)).toEqual([activeTaskId])
    expect(agentTaskService.listTasks('agent-trashed')).toEqual({ tasks: [], total: 0 })
    expect(agentTaskService.listTasks('agent-missing')).toEqual({ tasks: [], total: 0 })
    expect(agentTaskService.getTaskById(trashedTaskId)).toBeNull()
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toBeNull()
    expect(agentTaskService.getTaskById(missingTaskId)).toBeNull()
    expect(agentTaskService.getTask('agent-missing', missingTaskId)).toBeNull()

    dbh.db.update(agentTable).set({ deletedAt: null }).where(eq(agentTable.id, 'agent-trashed')).run()

    expect(new Set(agentTaskService.listAllTasks().tasks.map((task) => task.id))).toEqual(
      new Set([activeTaskId, trashedTaskId])
    )
    expect(agentTaskService.listTasks('agent-trashed').tasks.map((task) => task.id)).toEqual([trashedTaskId])
    expect(agentTaskService.getTaskById(trashedTaskId)).toMatchObject({
      id: trashedTaskId,
      agentId: 'agent-trashed'
    })
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toMatchObject({ id: trashedTaskId })
  })
})

describe('AgentTaskService ownership mutation contract', () => {
  const dbh = setupTestDatabase()

  it.each(['targeted', 'reconciliation'] as const)(
    '%s returns deleted schedules without deciding workspace ownership',
    (mode) => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'workspace', type: 'user', name: 'Workspace', path: '/tmp/task-workspace', orderKey: 'a0' })
        .run()
      const schedule = jobScheduleService.create({
        type: 'agent.task',
        name: 'heartbeat_missing',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {
          agentId: 'missing',
          prompt: '__heartbeat__',
          workspace: { type: 'user', workspaceId: 'workspace' }
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const result = dbh.db.transaction((tx) =>
        mode === 'targeted'
          ? agentTaskService.setOwnerStateTx(tx, 'missing', 'missing', Date.now())
          : agentTaskService.reconcileOwnerStatesTx(tx, Date.now())
      )

      expect(jobScheduleService.getById(schedule.id)).toBeNull()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ id: 'workspace' }])
      expect(result).toEqual({ scheduleIds: [schedule.id], deletedSchedules: [schedule] })
    }
  )
})

describe('Agent task dashboard durable results', () => {
  const dbh = setupTestDatabase()
  const createRun = (runId: string, overrides: Partial<typeof agentTaskRunTable.$inferInsert> = {}) =>
    agentTaskRunService.create({
      source: 'agent',
      runId,
      nameSnapshot: runId,
      agentNameSnapshot: 'Agent',
      startedAt: 1000,
      ...overrides
    })

  function seedSession(id = 'session'): void {
    if (!dbh.db.select().from(agentWorkspaceTable).get()) {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'workspace', type: 'user', name: 'Workspace', path: '/tmp/dashboard', orderKey: 'a0' })
        .run()
    }
    dbh.db.insert(agentSessionTable).values({ id, name: id, workspaceId: 'workspace', orderKey: id }).run()
  }

  it('keeps the first terminal outcome and one record for duplicate creation and completion', () => {
    const run = createRun('first')
    expect(createRun('first').id).toBe(run.id)
    agentTaskRunService.finish(run.id, 'succeeded', { endedAt: 5000, messageAnchor: 'result' })
    agentTaskRunService.finish(run.id, 'cancelled', { endedAt: 6000 })
    expect(agentTaskRunService.list('running').totals).toEqual({ running: 0, awaiting: 1 })
    expect(agentTaskRunService.list('awaiting').items).toMatchObject([
      { id: run.id, status: 'succeeded', endedAt: 5000, messageAnchor: 'result' }
    ])
  })

  it('groups concurrent task runs without losing the newest session or earliest start', () => {
    const task = jobScheduleService.create({
      type: 'agent.task',
      name: 'Daily triage',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })
    for (const id of ['newest', 'oldest', 'middle']) seedSession(id)
    const newest = createRun('newest', { source: 'scheduled', taskId: task.id, sessionId: 'newest', startedAt: 3000 })
    const oldest = createRun('oldest', {
      source: 'scheduled',
      taskId: task.id,
      sessionId: 'oldest',
      startedAt: 1000,
      blockedOn: 'approval'
    })
    const middle = createRun('middle', { source: 'scheduled', taskId: task.id, sessionId: 'middle', startedAt: 2000 })
    expect(agentTaskRunService.list('running')).toMatchObject({
      totals: { running: 1, awaiting: 0 },
      items: [{ sessionId: 'newest', startedAt: 1000, blockedOn: 'approval', runCount: 3 }]
    })
    expect(new Set(agentTaskRunService.list('running').items[0].runIds)).toEqual(
      new Set([newest.id, oldest.id, middle.id])
    )
    for (const row of [newest, oldest, middle]) agentTaskRunService.finish(row.id, 'succeeded', { endedAt: 4000 })
    expect(agentTaskRunService.list('awaiting').totals.awaiting).toBe(3)
  })

  it('does not count queued recovery as running or awaiting review', () => {
    const row = createRun('recovering')
    agentTaskRunService.updateActive(row.id, { status: 'queued' })
    expect(agentTaskRunService.list('running').totals).toEqual({ running: 0, awaiting: 0 })
    agentTaskRunService.updateActive(row.id, { status: 'running', startedAt: 10_000 })
    agentTaskRunService.finish(row.id, 'failed', { endedAt: 12_000, reasonCode: 'error' })
    expect(agentTaskRunService.list('awaiting').items[0]).toMatchObject({
      startedAt: 10_000,
      endedAt: 12_000,
      status: 'failed'
    })
  })

  it('reviews only completed results at the viewing boundary and preserves Stop results on automatic reads', () => {
    seedSession()
    const completed = createRun('completed', { sessionId: 'session' })
    const cancelled = createRun('cancelled', { sessionId: 'session' })
    const later = createRun('later', { sessionId: 'session' })
    const live = createRun('live', { sessionId: 'session' })
    agentTaskRunService.finish(completed.id, 'succeeded', { endedAt: 2000 })
    agentTaskRunService.finish(cancelled.id, 'cancelled', { endedAt: 2000, reasonCode: 'user_cancelled' })
    agentTaskRunService.finish(later.id, 'succeeded', { endedAt: 4000 })
    agentTaskRunService.review({ sessionId: 'session', through: 3000, automatic: true }, 3000)
    expect(agentTaskRunService.getById(completed.id)?.viewedAt).toBe(3000)
    expect(agentTaskRunService.getById(cancelled.id)?.viewedAt).toBeNull()
    expect(agentTaskRunService.getById(later.id)?.viewedAt).toBeNull()
    expect(agentTaskRunService.getById(live.id)?.status).toBe('running')
    agentTaskRunService.review({ sessionId: 'session', through: 3000 }, 3500)
    expect(agentTaskRunService.getById(cancelled.id)?.viewedAt).toBe(3500)
    expect(agentTaskRunService.getById(completed.id)?.viewedAt).toBe(3000)
  })

  it('retains unviewed results independently and expires viewed rows from their viewing time', () => {
    const unread = createRun('unread')
    const read = createRun('read')
    agentTaskRunService.finish(unread.id, 'failed', { endedAt: 2000 })
    agentTaskRunService.finish(read.id, 'succeeded', { endedAt: 2000 })
    agentTaskRunService.review({ id: read.id }, 10_000)
    agentTaskRunService.purgeViewed(10_000 + DASHBOARD_RETENTION_MS - 1)
    expect(agentTaskRunService.getById(read.id)).toBeDefined()
    agentTaskRunService.purgeViewed(10_000 + DASHBOARD_RETENTION_MS)
    expect(agentTaskRunService.getById(read.id)).toBeUndefined()
    expect(agentTaskRunService.getById(unread.id)?.viewedAt).toBeNull()
  })

  it('rolls back review with a failed deletion and preserves late terminal results as viewed after successful deletion', () => {
    const task = jobScheduleService.create({
      type: 'agent.task',
      name: 'Task',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const row = createRun('deleted', { source: 'scheduled', taskId: task.id })
    expect(() =>
      dbh.db.transaction((tx) => {
        jobScheduleService.deleteTx(tx, task.id)
        throw new Error('rollback')
      })
    ).toThrow('rollback')
    expect(agentTaskRunService.getById(row.id)).toMatchObject({ taskId: task.id, viewedAt: null })
    jobScheduleService.delete(task.id)
    agentTaskRunService.finish(row.id, 'cancelled', { endedAt: Date.now() })
    expect(agentTaskRunService.getById(row.id)?.taskId).toBeNull()
    expect(agentTaskRunService.getById(row.id)?.viewedAt).not.toBeNull()
    expect(agentTaskRunService.list('awaiting').items).toEqual([])
  })

  it('pages more than 2000 results with stable ties and accurate totals', () => {
    dbh.db.transaction((tx) => {
      for (let index = 0; index < 2001; index++) {
        tx.insert(agentTaskRunTable)
          .values({
            source: 'agent',
            runId: String(index),
            nameSnapshot: String(index),
            agentNameSnapshot: 'Agent',
            status: 'succeeded',
            startedAt: 1000,
            endedAt: 2000 + Math.floor(index / 3)
          })
          .run()
      }
    })
    const ids = new Set<string>()
    let cursor: string | undefined
    do {
      const page = agentTaskRunService.list('awaiting', cursor)
      expect(page.totals.awaiting).toBe(2001)
      expect(page.items.length).toBeLessThanOrEqual(50)
      for (const row of page.items) {
        expect(ids.has(row.id)).toBe(false)
        ids.add(row.id)
      }
      cursor = page.nextCursor
    } while (cursor)
    expect(ids.size).toBe(2001)
  })
})

describe('Agent dashboard lifecycle integration', () => {
  const dbh = setupTestDatabase()
  type WorkSnapshot = NonNullable<ReturnType<AgentSessionRuntimeService['getWorkSnapshot']>>
  let service: AgentTaskDashboardService
  let snapshot: WorkSnapshot | undefined
  let workChanged: Emitter<string>
  let jobChanged: Emitter<JobSnapshot>
  let recovered: Emitter<void>
  let locked: Emitter<void>
  let unlocked: Emitter<void>
  let restoreContainer: () => void
  let focused: boolean
  let idle: 'active' | 'idle' | 'locked' | 'unknown'
  let beforeAbortGate: Promise<void> | undefined
  let cancelFailure: string | undefined

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', type: 'user', name: 'Workspace', path: '/tmp/dashboard-runtime', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', name: 'Task', agentId: 'agent', workspaceId: 'workspace', orderKey: 'a0' })
      .run()
    snapshot = undefined
    focused = true
    idle = 'active'
    beforeAbortGate = undefined
    cancelFailure = undefined
    workChanged = new Emitter<string>()
    jobChanged = new Emitter<JobSnapshot>()
    recovered = new Emitter<void>()
    locked = new Emitter<void>()
    unlocked = new Emitter<void>()
    const container = application.getContainer()
    const originalGet = container.get.bind(container)
    const windows = application.get('WindowManager')
    const services: Record<string, unknown> = {
      AgentSessionRuntimeService: { onWorkChanged: workChanged.event, getWorkSnapshot: () => snapshot },
      JobManager: {
        onJobChanged: jobChanged.event,
        onRecoveryCompleted: recovered.event,
        startupRecoveryComplete: false,
        isExecuting: () => false,
        cancel: async (jobId: string) => {
          if (jobId === cancelFailure) throw new Error('Cannot stop')
          dbh.db
            .update(jobTable)
            .set({ status: 'cancelled', finishedAt: Date.now() })
            .where(eq(jobTable.id, jobId))
            .run()
          jobChanged.fire(jobService.getById(jobId)!)
          return { outcome: 'cancelled' }
        }
      },
      PowerService: {
        onLockScreen: locked.event,
        onUnlockScreen: unlocked.event,
        getPowerPhase: () => 'active',
        getSystemIdleState: () => idle
      },
      WindowManager: {
        ...windows,
        getWindowInfosByType: (type: string) =>
          type === 'main' ? [{ id: 'main', isFocused: focused, isVisible: true }] : []
      },
      AiStreamManager: {
        abortAndDrain: async (_topic: string, _reason: string, beforeAbort: () => void) => {
          if (beforeAbortGate) await beforeAbortGate
          beforeAbort()
          snapshot = { ...snapshot!, busy: false, terminalStatus: 'paused' }
          workChanged.fire('session')
        }
      }
    }
    const spy = vi
      .spyOn(container, 'get')
      .mockImplementation(
        ((name: string) =>
          services[name] ?? originalGet(name as Parameters<typeof originalGet>[0])) as typeof container.get
      )
    restoreContainer = () => spy.mockRestore()
    service = new AgentTaskDashboardService()
    await service._doInit()
  })

  afterEach(async () => {
    await service?._doStop()
    await service?._doDestroy()
    restoreContainer?.()
    vi.useRealTimers()
  })

  function start(turnId = 'turn-1', sourceJobId?: string): void {
    snapshot = {
      agentId: 'agent',
      busy: true,
      turnId,
      messageAnchor: 'message-1',
      terminalStatus: undefined,
      sourceJobId
    }
    workChanged.fire('session')
  }

  function finish(status: 'success' | 'paused' | 'error' = 'success'): void {
    snapshot = { ...snapshot!, busy: false, terminalStatus: status }
    workChanged.fire('session')
  }

  it('creates no short-run row, crosses 60 seconds once, and keeps identity through queued follow-ups', async () => {
    start('short')
    await vi.advanceTimersByTimeAsync(59_000)
    finish()
    expect(dbh.db.select().from(agentTaskRunTable).all()).toEqual([])
    start()
    await vi.advanceTimersByTimeAsync(60_000)
    const first = agentTaskRunService.list('running').items[0]
    expect(first).toMatchObject({ runCount: 1, startedAt: 1_059_000 })
    snapshot = { ...snapshot!, turnId: 'follow-up', messageAnchor: 'message-2', terminalStatus: 'success' }
    workChanged.fire('session')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(agentTaskRunService.list('running').items[0].runIds).toEqual(first.runIds)
    expect(agentTaskRunService.getById(first.runIds[0])?.messageAnchor).toBe('message-1')
    finish()
    expect(agentTaskRunService.list('awaiting').items).toMatchObject([
      { id: first.runIds[0], messageAnchor: 'message-2', endedAt: 1_129_000, status: 'succeeded' }
    ])
  })

  it('persists a 61-second result even if the threshold timer has not fired', () => {
    start()
    vi.setSystemTime(1_061_000)
    finish('error')
    expect(agentTaskRunService.list('awaiting').items).toMatchObject([
      { status: 'failed', reasonCode: 'error', startedAt: 1_000_000, endedAt: 1_061_000 }
    ])
  })

  it('counts approval waits as continuous work and clears the blocked marker after approval', async () => {
    start()
    const cache = application.get('CacheService')
    const key = 'topic.stream.statuses.agent-session:session' as const
    cache.setShared(key, {
      status: 'awaiting-approval',
      activeExecutions: [],
      awaitingApprovalAnchors: [{ executionId: 'provider::model', attemptId: 1, anchorMessageId: 'message-1' }]
    })
    finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(agentTaskRunService.list('running').items[0]).toMatchObject({ blockedOn: 'approval', startedAt: 1_000_000 })
    cache.setShared(key, null)
    snapshot = { ...snapshot!, busy: true }
    workChanged.fire('session')
    expect(agentTaskRunService.list('running').items[0].blockedOn).toBeNull()
    finish()
    expect(agentTaskRunService.list('awaiting').items).toHaveLength(1)
  })

  it('reconciles queued recovery without claiming a user turn in the same session', async () => {
    const row = agentTaskRunService.create({
      source: 'agent',
      runId: 'interrupted',
      sessionId: 'session',
      nameSnapshot: 'Old run',
      agentNameSnapshot: 'Agent',
      startedAt: 100,
      lastActivityAt: 300
    })
    const job = dbh.db
      .insert(jobTable)
      .values({
        type: 'agent.task',
        status: 'pending',
        queue: 'agent:agent',
        input: { agentId: 'agent', prompt: 'Scheduled task' },
        scheduledAt: Date.now(),
        metadata: { sessionId: 'session' }
      })
      .returning()
      .get()
    const scheduled = agentTaskRunService.create({
      source: 'scheduled',
      runId: job.id,
      sessionId: 'session',
      nameSnapshot: 'Recovered task',
      agentNameSnapshot: 'Agent',
      startedAt: 100,
      lastActivityAt: 300
    })
    await service._doStop()
    await service._doDestroy()
    BaseService.resetInstances()
    service = new AgentTaskDashboardService()
    await service._doInit()
    expect(agentTaskRunService.getById(row.id)).toMatchObject({
      status: 'failed',
      reasonCode: 'interrupted',
      endedAt: 300
    })
    expect(agentTaskRunService.getById(scheduled.id)?.status).toBe('queued')
    recovered.fire()
    expect(agentTaskRunService.getById(scheduled.id)?.status).toBe('queued')
    start('interactive')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(agentTaskRunService.list('running').items).toMatchObject([{ source: 'agent', runId: 'interactive' }])
    finish()
    dbh.db.update(jobTable).set({ status: 'running', startedAt: Date.now() }).where(eq(jobTable.id, job.id)).run()
    jobChanged.fire(jobService.getById(job.id)!)
    expect(agentTaskRunService.list('running').items).toMatchObject([{ source: 'scheduled', startedAt: Date.now() }])
  })

  it('reports partial Stop failures and leaves the failed run active without touching later runs', async () => {
    const rows = ['ok', 'fail', 'later'].map((name) => {
      const job = dbh.db
        .insert(jobTable)
        .values({
          type: 'agent.task',
          status: 'running',
          queue: 'agent:agent',
          input: { agentId: 'agent', prompt: name },
          scheduledAt: Date.now(),
          startedAt: Date.now()
        })
        .returning()
        .get()
      jobChanged.fire(jobService.getById(job.id)!)
      return agentTaskRunService.getByRun('scheduled', job.id)!
    })
    cancelFailure = rows[1].runId
    expect(await service.stop([rows[0].id, rows[1].id])).toEqual([
      { id: rows[0].id, result: 'cancelled' },
      { id: rows[1].id, result: 'failed' }
    ])
    expect(agentTaskRunService.getById(rows[0].id)?.status).toBe('cancelled')
    expect(agentTaskRunService.getById(rows[1].id)?.status).toBe('running')
    expect(agentTaskRunService.getById(rows[2].id)?.status).toBe('running')
  })

  it('retains scheduled ownership through detached background work after the job settles', async () => {
    const job = dbh.db
      .insert(jobTable)
      .values({
        type: 'agent.task',
        status: 'running',
        queue: 'agent:agent',
        input: { agentId: 'agent', prompt: 'Scheduled task' },
        scheduledAt: Date.now(),
        startedAt: Date.now(),
        metadata: { sessionId: 'session' }
      })
      .returning()
      .get()
    jobChanged.fire(jobService.getById(job.id)!)
    start('scheduled-turn', job.id)
    dbh.db.update(jobTable).set({ status: 'completed', finishedAt: Date.now() }).where(eq(jobTable.id, job.id)).run()
    jobChanged.fire(jobService.getById(job.id)!)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(agentTaskRunService.list('running').items).toEqual([])
    expect(dbh.db.select().from(agentTaskRunTable).all()).toMatchObject([
      { source: 'scheduled', runId: job.id, status: 'succeeded' }
    ])
    finish()
    start('new-user-run')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(agentTaskRunService.list('running').items[0]).toMatchObject({ source: 'agent', runId: 'new-user-run' })
  })

  it('keeps a Stop result unviewed during automatic reads and rejects a stale Stop after a successor starts', async () => {
    start()
    await vi.advanceTimersByTimeAsync(60_000)
    const id = agentTaskRunService.list('running').items[0].runIds[0]
    expect(await service.stop([id])).toEqual([{ id, result: 'cancelled' }])
    service.viewSession('session', 'main', true)
    expect(agentTaskRunService.list('awaiting').items).toMatchObject([{ id, status: 'cancelled', viewedAt: null }])
    service.viewSession('session', 'main', false)
    expect(agentTaskRunService.list('awaiting').items).toEqual([])
    start('next')
    await vi.advanceTimersByTimeAsync(60_000)
    const nextId = agentTaskRunService.list('running').items[0].runIds[0]
    let release!: () => void
    beforeAbortGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = service.stop([nextId])
    finish()
    start('replacement')
    release()
    expect(await pending).toEqual([{ id: nextId, result: 'skipped' }])
    expect(snapshot).toMatchObject({ turnId: 'replacement', busy: true })
  })

  it('does not auto-read while unfocused, locked, idle, or power state is unknown', async () => {
    start()
    await vi.advanceTimersByTimeAsync(60_000)
    finish()
    focused = false
    service.viewSession('session', 'main', true)
    focused = true
    locked.fire()
    service.viewSession('session', 'main', true)
    unlocked.fire()
    idle = 'idle'
    service.viewSession('session', 'main', true)
    idle = 'unknown'
    service.viewSession('session', 'main', true)
    expect(agentTaskRunService.list('awaiting').totals.awaiting).toBe(1)
    idle = 'active'
    service.viewSession('session', 'main', true)
    expect(agentTaskRunService.list('awaiting').totals.awaiting).toBe(0)
  })

  it('reconciles a terminal job whose stored session was deleted without reviving its foreign key', () => {
    const job = dbh.db
      .insert(jobTable)
      .values({
        type: 'agent.task',
        status: 'running',
        queue: 'agent:agent',
        input: { agentId: 'agent', prompt: 'Scheduled task' },
        scheduledAt: Date.now(),
        startedAt: Date.now(),
        metadata: { sessionId: 'session' }
      })
      .returning()
      .get()
    jobChanged.fire(jobService.getById(job.id)!)
    dbh.db.transaction((tx) => {
      agentTaskRunService.reviewDeletedTx(tx, { sessionIds: ['session'] })
      tx.delete(agentSessionTable).where(eq(agentSessionTable.id, 'session')).run()
      tx.update(jobTable).set({ status: 'completed', finishedAt: Date.now() }).where(eq(jobTable.id, job.id)).run()
    })
    recovered.fire()
    expect(agentTaskRunService.getByRun('scheduled', job.id)).toMatchObject({ status: 'succeeded', sessionId: null })
    expect(agentTaskRunService.list('awaiting').items).toEqual([])
  })
})
