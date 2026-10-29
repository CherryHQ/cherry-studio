import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobTable } from '@data/db/schemas/job'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { AgentTaskDashboardService } from '@main/ai/agents/AgentTaskDashboardService'
import type { AgentSessionRuntimeSnapshot } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService, Emitter } from '@main/core/lifecycle'
import { AGENT_TASK_DASHBOARD_CACHE_KEY, DASHBOARD_LONG_RUN_MS } from '@shared/ai/agentTaskDashboard'
import type { InferSharedCacheValue, SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import { templateToRegex } from '@shared/data/cache/templateKey'

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
    expect(agentTaskService.getTaskDetail(trashedTaskId)).toBeNull()
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toBeNull()
    expect(agentTaskService.getTaskById(missingTaskId)).toBeNull()
    expect(agentTaskService.getTaskDetail(missingTaskId)).toBeNull()
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

  it.each(['pending', 'delayed'])(
    'reports %s as queued until execution starts, then reports its actual outcome',
    (status) => {
      seedAgent('agent-active')
      const taskId = seedTask('task-active', 'agent-active')
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toBeNull()
      const now = Date.now()
      dbh.db
        .insert(jobTable)
        .values({
          id: 'run',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status,
          scheduledAt: now,
          input: {}
        })
        .run()
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'queued' })

      dbh.db.update(jobTable).set({ status: 'running', startedAt: now }).where(eq(jobTable.id, 'run')).run()
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'running' })

      dbh.db
        .update(jobTable)
        .set({ status: 'failed', finishedAt: now + 1000 })
        .where(eq(jobTable.id, 'run'))
        .run()
      expect(agentTaskService.getTaskDetail(taskId)).toMatchObject({
        status: 'active',
        runSummary: { status: 'failed', finishedAt: new Date(now + 1000).toISOString() }
      })
    }
  )

  it('keeps an active execution visible when a newer run is queued', () => {
    seedAgent('agent-active')
    const taskId = seedTask('task-active', 'agent-active')
    const now = Date.now()
    dbh.db
      .insert(jobTable)
      .values([
        {
          id: 'running',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status: 'running',
          scheduledAt: now,
          startedAt: now,
          input: {}
        },
        {
          id: 'queued',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status: 'pending',
          scheduledAt: now + 1000,
          input: {}
        }
      ])
      .run()
    expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'running' })
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

describe('Agent dashboard running projection', () => {
  const dbh = setupTestDatabase()
  const snapshots = new Map<string, AgentSessionRuntimeSnapshot>()
  const executingJobs = new Set<string>()
  let service: AgentTaskDashboardService
  let workChanged: Emitter<string>
  let restoreContainer: () => void
  let beforeAbortGate: Promise<void> | undefined
  let cancelFailure: string | undefined

  const cache = () => application.get('CacheService')
  const entries = () => cache().getShared(AGENT_TASK_DASHBOARD_CACHE_KEY) ?? []
  const refresh = () => vi.advanceTimersByTimeAsync(1000)

  // The unified cache mock stores values but leaves subscription delivery to the test.
  function emitShared<K extends SharedCacheKey>(key: K, value: InferSharedCacheValue<K>): void {
    const oldValue = cache().getShared(key)
    cache().setShared(key, value)
    for (const [pattern, callback] of [...vi.mocked(cache().subscribeSharedChange).mock.calls]) {
      if (pattern === key || templateToRegex(pattern).test(key)) callback(value, oldValue, key)
    }
  }

  function publishJob(id: string): void {
    emitShared(`jobs.state.${id}`, jobService.getById(id))
  }

  function seedSession(id: string): void {
    dbh.db
      .insert(agentSessionTable)
      .values({ id, name: id, agentId: 'agent', workspaceId: 'workspace', orderKey: id })
      .run()
  }

  function seedJob(overrides: Partial<typeof jobTable.$inferInsert> = {}, executing = true): string {
    const row = dbh.db
      .insert(jobTable)
      .values({
        type: 'agent.task',
        status: 'running',
        queue: 'agent:agent',
        input: { agentId: 'agent', prompt: 'Scheduled task' },
        scheduledAt: Date.now(),
        startedAt: Date.now(),
        metadata: { sessionId: 'session' },
        ...overrides
      })
      .returning()
      .get()
    if (executing) executingJobs.add(row.id)
    return row.id
  }

  function start(sessionId = 'session', overrides: Partial<AgentSessionRuntimeSnapshot> = {}): void {
    snapshots.set(sessionId, {
      sessionId,
      agentId: 'agent',
      busy: true,
      turnId: 'turn-1',
      topicId: `agent-session:${sessionId}`,
      assistantMessageId: 'message-1',
      status: 'active',
      pendingMessageCount: 0,
      activeToolCount: 0,
      ...overrides
    })
    workChanged.fire(sessionId)
  }

  function registerApproval(presentation: 'stream' | 'message'): void {
    toolApprovalRegistry.register({
      approvalId: 'approval',
      sessionId: 'session',
      toolCallId: 'ask-user',
      toolName: 'AskUserQuestion',
      originalInput: {},
      presentation,
      resolve: vi.fn()
    })
  }

  function finish(sessionId = 'session'): void {
    snapshots.set(sessionId, { ...snapshots.get(sessionId)!, busy: false, status: 'idle' })
    workChanged.fire(sessionId)
  }

  async function restartService(): Promise<void> {
    await service._doStop()
    await service._doDestroy()
    BaseService.resetInstances()
    vi.mocked(cache().subscribeSharedChange).mockClear()
    service = new AgentTaskDashboardService()
    await service._doInit()
  }

  beforeEach(async () => {
    toolApprovalRegistry.clear('test-reset')
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
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
    seedSession('session')
    snapshots.clear()
    executingJobs.clear()
    beforeAbortGate = undefined
    cancelFailure = undefined
    workChanged = new Emitter<string>()
    const container = application.getContainer()
    const originalGet = container.get.bind(container)
    const services: Record<string, unknown> = {
      AgentSessionRuntimeService: {
        onWorkChanged: workChanged.event,
        inspect: (sessionId: string) => snapshots.get(sessionId),
        listSnapshots: () => [...snapshots.values()]
      },
      JobManager: {
        isExecuting: (jobId: string) => executingJobs.has(jobId),
        cancel: async (jobId: string) => {
          if (jobId === cancelFailure) throw new Error('Cannot stop')
          dbh.db
            .update(jobTable)
            .set({ status: 'cancelled', finishedAt: Date.now() })
            .where(eq(jobTable.id, jobId))
            .run()
          executingJobs.delete(jobId)
          publishJob(jobId)
          return { outcome: 'cancelled' }
        }
      },
      AiStreamManager: {
        abortAndDrain: async (topicId: string, _reason: string, beforeAbort: () => void) => {
          if (beforeAbortGate) await beforeAbortGate
          beforeAbort()
          finish(topicId.slice('agent-session:'.length))
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
    toolApprovalRegistry.clear('test-cleanup')
    restoreContainer?.()
    workChanged?.dispose()
    MockMainCacheServiceUtils.resetMocks()
    vi.useRealTimers()
  })

  it('hides short runs, crosses the 60-second boundary once and preserves identity through follow-ups', async () => {
    start()
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS - 1)
    expect(entries()).toEqual([])
    finish()
    await refresh()
    expect(entries()).toEqual([])

    const startedAt = Date.now()
    start()
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS - 1)
    expect(entries()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    const first = entries()[0]
    expect(entries()).toHaveLength(1)
    expect(first).toMatchObject({ source: 'agent', sessionId: 'session', startedAt, runCount: 1 })
    start('session', { turnId: 'follow-up', assistantMessageId: 'message-2', pendingMessageCount: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(entries()[0]).toMatchObject({ id: first.id, runIds: first.runIds, startedAt, messageAnchor: 'message-2' })
    finish()
    await refresh()
    expect(entries()).toEqual([])
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(entries()).toEqual([])
  })

  it.each(['stream', 'message'] as const)(
    'counts a %s approval wait as continuous work and removes it when the idle approval is resolved',
    async (presentation) => {
      start()
      const startedAt = Date.now()
      registerApproval(presentation)
      finish()
      await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
      expect(entries()).toHaveLength(1)
      expect(entries()[0]).toMatchObject({ startedAt, blockedOn: 'approval' })
      toolApprovalRegistry.dispatch('approval', { approved: true })
      await refresh()
      expect(entries()).toEqual([])
    }
  )

  it('discovers live work on late initialization without reviving queued or stale running jobs', async () => {
    start()
    seedSession('scheduled')
    const live = seedJob({ metadata: { sessionId: 'scheduled' } })
    seedJob({}, false)
    seedJob({ status: 'pending', startedAt: null }, false)
    seedJob({ input: { agentId: 'agent', prompt: '__heartbeat__' } })
    await restartService()
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ source: 'scheduled', runIds: [`scheduled:${live}`] })
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(
      entries()
        .map((entry) => entry.source)
        .sort()
    ).toEqual(['agent', 'scheduled'])
  })

  it.each(['stream', 'message'] as const)(
    'groups scheduled runs without the long-run threshold and keeps elapsed time, newest session and %s approval',
    async (presentation) => {
      const schedule = jobScheduleService.create({
        type: 'agent.task',
        name: 'Daily triage',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: { agentId: 'agent', prompt: 'Scheduled task' },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      seedSession('newest')
      const oldest = seedJob({ scheduleId: schedule.id, startedAt: 1000 })
      start('session', { sourceJobId: oldest })
      registerApproval(presentation)
      const newest = seedJob({ scheduleId: schedule.id, startedAt: 3000, metadata: { sessionId: 'newest' } })
      publishJob(newest)
      await refresh()
      expect(entries()).toHaveLength(1)
      expect(entries()[0]).toMatchObject({
        source: 'scheduled',
        taskId: schedule.id,
        nameSnapshot: 'Daily triage',
        sessionId: 'newest',
        startedAt: 1000,
        blockedOn: 'approval',
        runCount: 2
      })
      expect(new Set(entries()[0].runIds)).toEqual(new Set([`scheduled:${oldest}`, `scheduled:${newest}`]))
      toolApprovalRegistry.dispatch('approval', { approved: true })
      await refresh()
      expect(entries()).toHaveLength(1)
      expect(entries()[0]).toMatchObject({ blockedOn: null, runCount: 2 })
    }
  )

  it.each(['completed', 'failed', 'cancelled'] as const)('removes a scheduled run on %s', async (status) => {
    const id = seedJob()
    publishJob(id)
    await refresh()
    expect(entries()).toHaveLength(1)
    dbh.db.update(jobTable).set({ status, finishedAt: Date.now() }).where(eq(jobTable.id, id)).run()
    executingJobs.delete(id)
    publishJob(id)
    await refresh()
    expect(entries()).toEqual([])
  })

  it('does not duplicate scheduled work as ordinary work, including after the job settles', async () => {
    const id = seedJob()
    publishJob(id)
    start('session', { sourceJobId: id })
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(entries()).toHaveLength(1)
    expect(entries()[0].source).toBe('scheduled')
    dbh.db.update(jobTable).set({ status: 'completed', finishedAt: Date.now() }).where(eq(jobTable.id, id)).run()
    executingJobs.delete(id)
    publishJob(id)
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(entries()).toEqual([])
    finish()
    start('session', { turnId: 'next-user-turn' })
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(entries()).toHaveLength(1)
    expect(entries()[0].source).toBe('agent')
  })

  it('reports partial grouped Stop failures and preserves runs started after the captured group', async () => {
    const schedule = jobScheduleService.create({
      type: 'agent.task',
      name: 'Concurrent tasks',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: { agentId: 'agent', prompt: 'Scheduled task' },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const successful = seedJob({ scheduleId: schedule.id })
    cancelFailure = seedJob({ scheduleId: schedule.id })
    publishJob(successful)
    await refresh()
    const captured = [...entries()[0].runIds]
    const later = seedJob({ scheduleId: schedule.id })
    publishJob(later)
    await refresh()
    const result = await service.stop(captured)
    await refresh()
    expect(result).toEqual(
      captured.map((id) => ({ id, result: id === `scheduled:${cancelFailure}` ? 'failed' : 'cancelled' }))
    )
    expect(jobService.getById(successful)?.status).toBe('cancelled')
    expect(jobService.getById(cancelFailure)?.status).toBe('running')
    expect(jobService.getById(later)?.status).toBe('running')
    expect(new Set(entries()[0].runIds)).toEqual(new Set([`scheduled:${cancelFailure}`, `scheduled:${later}`]))
  })

  it('stops ordinary work but rejects a delayed Stop when a successor has started', async () => {
    start()
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    const firstId = entries()[0].runIds[0]
    expect(await service.stop([firstId])).toEqual([{ id: firstId, result: 'cancelled' }])
    await refresh()
    expect(entries()).toEqual([])
    start('session', { turnId: 'next' })
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    const id = entries()[0].runIds[0]
    expect(id).not.toBe(firstId)
    let release!: () => void
    beforeAbortGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stopping = service.stop([id])
    finish()
    start('session', { turnId: 'replacement' })
    release()
    expect(await stopping).toEqual([{ id, result: 'skipped' }])
    expect(snapshots.get('session')).toMatchObject({ turnId: 'replacement', busy: true })
    await vi.advanceTimersByTimeAsync(DASHBOARD_LONG_RUN_MS)
    expect(entries()).toHaveLength(1)
    expect(entries()[0].runIds[0]).not.toBe(id)
  })
})
