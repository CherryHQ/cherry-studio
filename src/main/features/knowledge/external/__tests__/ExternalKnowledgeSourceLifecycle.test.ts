import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import type { DbOrTx } from '@data/db/types'

const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333'

const {
  cancelMock,
  getJobMock,
  registerScheduleTxMock,
  requestSyncForTriggerMock,
  syncTimerMock,
  unregisterScheduleMock,
  updateScheduleTxMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getJobMock: vi.fn(),
  registerScheduleTxMock: vi.fn(),
  requestSyncForTriggerMock: vi.fn(),
  syncTimerMock: vi.fn(),
  unregisterScheduleMock: vi.fn(),
  updateScheduleTxMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      get: getJobMock,
      registerJobScheduleTx: registerScheduleTxMock,
      syncJobScheduleTimerById: syncTimerMock,
      unregisterJobScheduleById: unregisterScheduleMock,
      updateJobScheduleTx: updateScheduleTxMock
    }
  })
})

const { ExternalKnowledgeSourceLifecycle } = await import('../ExternalKnowledgeSourceLifecycle')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d10-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const SECOND_SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abd'
const JOB_ID = '0198f3f2-7d12-7abc-8def-123456789abc'

describe('ExternalKnowledgeSourceLifecycle', () => {
  const dbh = setupTestDatabase()
  const lifecycle = new ExternalKnowledgeSourceLifecycle({ requestSyncForTrigger: requestSyncForTriggerMock })

  const seedSource = (
    options: {
      state?: 'active' | 'paused'
      scheduleId?: string | null
      activeJobId?: string | null
      revision?: number
    } = {}
  ) => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'Base',
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_example',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'connected',
        credentialReference: 'credential-reference-only',
        accountUserId: 'user-1',
        accountOpenId: 'open-1',
        tenantKey: 'tenant-1',
        displayName: 'Ada',
        grantedScopes: ['wiki:node:read'],
        authorizedAt: 100,
        lastValidatedAt: 100
      })
      .run()
    if (options.scheduleId) seedSchedule(options.scheduleId, options.state !== 'paused', options.revision ?? 3)
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: SOURCE_ID,
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-1',
        scope: { kind: 'space' },
        name: 'Engineering Wiki',
        state: options.state ?? 'active',
        scheduleId: options.scheduleId ?? null,
        revision: options.revision ?? 3,
        activeJobId: options.activeJobId ?? null
      })
      .run()
  }

  const seedSchedule = (id = SCHEDULE_ID, enabled = true, sourceRevision = 3, sourceId = SOURCE_ID) =>
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id,
        type: 'knowledge.sync-external-source',
        name: `external-knowledge-source-${sourceId}`,
        trigger: { kind: 'cron', expr: '5 9 * * *', timezone: 'Asia/Shanghai' },
        jobInputTemplate: {
          baseId: BASE_ID,
          sourceId,
          sourceRevision,
          trigger: 'scheduled',
          dispatch: 'schedule'
        },
        enabled,
        catchUpPolicy: { kind: 'after-startup', minutes: 0 }
      })
      .run()

  beforeEach(() => {
    vi.clearAllMocks()
    registerScheduleTxMock.mockImplementation((tx: DbOrTx, input: Record<string, unknown>) => {
      tx.insert(jobScheduleTable)
        .values({ id: SCHEDULE_ID, ...(input as typeof jobScheduleTable.$inferInsert) })
        .run()
      return { id: SCHEDULE_ID }
    })
    updateScheduleTxMock.mockImplementation((tx: DbOrTx, id: string, patch: Record<string, unknown>) => {
      tx.update(jobScheduleTable).set(patch).where(eq(jobScheduleTable.id, id)).run()
      return {}
    })
    unregisterScheduleMock.mockImplementation(async (id: string) => {
      const result = dbh.db.delete(jobScheduleTable).where(eq(jobScheduleTable.id, id)).run()
      return result.changes > 0
    })
    requestSyncForTriggerMock.mockResolvedValue(undefined)
  })

  it('keeps the default manual-only policy without creating a schedule', async () => {
    seedSource()

    const source = await lifecycle.updateSchedulePolicy({ sourceId: SOURCE_ID, policy: { kind: 'manual' } })

    expect(source.scheduleId).toBeNull()
    expect(registerScheduleTxMock).not.toHaveBeenCalled()
    expect(syncTimerMock).not.toHaveBeenCalled()
    expect(unregisterScheduleMock).not.toHaveBeenCalled()
  })

  it('atomically creates one daily schedule, links it to the source, then syncs the timer after commit', async () => {
    seedSource()
    syncTimerMock.mockImplementationOnce((id: string) => {
      expect(dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.id, id)).get()).toBeDefined()
      expect(
        dbh.db.select().from(externalKnowledgeSourceTable).where(eq(externalKnowledgeSourceTable.id, SOURCE_ID)).get()
      ).toMatchObject({ scheduleId: id })
    })

    const source = await lifecycle.updateSchedulePolicy({
      sourceId: SOURCE_ID,
      policy: { kind: 'daily', time: '09:05', timezone: 'Asia/Shanghai' }
    })

    expect(source.scheduleId).toBe(SCHEDULE_ID)
    expect(registerScheduleTxMock).toHaveBeenCalledWith(expect.anything(), {
      type: 'knowledge.sync-external-source',
      name: `external-knowledge-source-${SOURCE_ID}`,
      trigger: { kind: 'cron', expr: '5 9 * * *', timezone: 'Asia/Shanghai' },
      jobInputTemplate: {
        baseId: BASE_ID,
        sourceId: SOURCE_ID,
        sourceRevision: 3,
        trigger: 'scheduled',
        dispatch: 'schedule'
      },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 },
      enabled: true
    })
    expect(syncTimerMock).toHaveBeenCalledWith(SCHEDULE_ID)
  })

  it('updates the existing daily trigger and preserves one schedule', async () => {
    seedSource({ scheduleId: SCHEDULE_ID })

    const source = await lifecycle.updateSchedulePolicy({
      sourceId: SOURCE_ID,
      policy: { kind: 'daily', time: '18:30', timezone: 'Europe/Paris' }
    })

    expect(source.scheduleId).toBe(SCHEDULE_ID)
    expect(registerScheduleTxMock).not.toHaveBeenCalled()
    expect(updateScheduleTxMock).toHaveBeenCalledWith(expect.anything(), SCHEDULE_ID, {
      trigger: { kind: 'cron', expr: '30 18 * * *', timezone: 'Europe/Paris' },
      jobInputTemplate: {
        baseId: BASE_ID,
        sourceId: SOURCE_ID,
        sourceRevision: 3,
        trigger: 'scheduled',
        dispatch: 'schedule'
      },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 },
      enabled: true
    })
    expect(dbh.db.select().from(jobScheduleTable).all()).toHaveLength(1)
    expect(syncTimerMock).toHaveBeenCalledWith(SCHEDULE_ID)
  })

  it('uses public unregister before relying on ON DELETE SET NULL for manual-only', async () => {
    seedSource({ scheduleId: SCHEDULE_ID })

    const source = await lifecycle.updateSchedulePolicy({ sourceId: SOURCE_ID, policy: { kind: 'manual' } })

    expect(unregisterScheduleMock).toHaveBeenCalledWith(SCHEDULE_ID)
    expect(source.scheduleId).toBeNull()
    expect(dbh.db.select().from(jobScheduleTable).all()).toEqual([])
  })

  it('leaves the source linked when unregister fails', async () => {
    seedSource({ scheduleId: SCHEDULE_ID })
    unregisterScheduleMock.mockRejectedValueOnce(new Error('unregister failed'))

    await expect(lifecycle.updateSchedulePolicy({ sourceId: SOURCE_ID, policy: { kind: 'manual' } })).rejects.toThrow(
      'unregister failed'
    )

    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.scheduleId).toBe(SCHEDULE_ID)
    expect(dbh.db.select().from(jobScheduleTable).all()).toHaveLength(1)
  })

  it('rolls back schedule creation without synchronizing a timer when its transaction fails', async () => {
    seedSource()
    registerScheduleTxMock.mockImplementationOnce((tx: DbOrTx, input: Record<string, unknown>) => {
      tx.insert(jobScheduleTable)
        .values({ id: SCHEDULE_ID, ...(input as typeof jobScheduleTable.$inferInsert) })
        .run()
      throw new Error('link failed')
    })

    await expect(
      lifecycle.updateSchedulePolicy({
        sourceId: SOURCE_ID,
        policy: { kind: 'daily', time: '09:05', timezone: 'Asia/Shanghai' }
      })
    ).rejects.toThrow('link failed')

    expect(dbh.db.select().from(jobScheduleTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.scheduleId).toBeNull()
    expect(syncTimerMock).not.toHaveBeenCalled()
  })

  it('pauses and resumes source admission with the schedule in the same transaction without enqueueing', async () => {
    seedSource({ scheduleId: SCHEDULE_ID })

    const paused = await lifecycle.pauseSource(SOURCE_ID)
    expect(paused).toMatchObject({ state: 'paused', revision: 4 })
    expect(dbh.db.select().from(jobScheduleTable).get()).toMatchObject({
      enabled: false,
      jobInputTemplate: expect.objectContaining({ sourceRevision: 4 })
    })
    expect(syncTimerMock).toHaveBeenLastCalledWith(SCHEDULE_ID)

    const resumed = await lifecycle.resumeSource(SOURCE_ID)
    expect(resumed).toMatchObject({ state: 'active', revision: 5 })
    expect(dbh.db.select().from(jobScheduleTable).get()).toMatchObject({
      enabled: true,
      jobInputTemplate: expect.objectContaining({ sourceRevision: 5 })
    })
    expect(requestSyncForTriggerMock).not.toHaveBeenCalled()
    expect(syncTimerMock).toHaveBeenCalledTimes(2)
  })

  it('atomically pauses every active source for reauthorization and disables all dependent schedules', () => {
    seedSource({ scheduleId: SCHEDULE_ID })
    const secondScheduleId = '44444444-4444-4444-8444-444444444444'
    seedSchedule(secondScheduleId, true, 7, SECOND_SOURCE_ID)
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: SECOND_SOURCE_ID,
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-2',
        scope: { kind: 'space' },
        name: 'Already paused Wiki',
        state: 'paused',
        scheduleId: secondScheduleId,
        revision: 7
      })
      .run()

    lifecycle.pauseForReauthorization(CONNECTION_ID)

    expect(
      dbh.db.select().from(externalKnowledgeSourceTable).orderBy(externalKnowledgeSourceTable.id).all()
    ).toMatchObject([
      { id: SOURCE_ID, state: 'paused', revision: 4 },
      { id: SECOND_SOURCE_ID, state: 'paused', revision: 7 }
    ])
    expect(dbh.db.select().from(jobScheduleTable).orderBy(jobScheduleTable.id).all()).toMatchObject([
      { id: SCHEDULE_ID, enabled: false, jobInputTemplate: expect.objectContaining({ sourceRevision: 4 }) },
      { id: secondScheduleId, enabled: false, jobInputTemplate: expect.objectContaining({ sourceRevision: 7 }) }
    ])
    expect(syncTimerMock).toHaveBeenCalledTimes(2)
  })

  it('restores all paused sources and schedules after reauthorization without starting a sync', () => {
    seedSource({ state: 'paused', scheduleId: SCHEDULE_ID })

    lifecycle.resumeAfterReauthorization(CONNECTION_ID)

    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()).toMatchObject({ state: 'active', revision: 4 })
    expect(dbh.db.select().from(jobScheduleTable).get()).toMatchObject({
      enabled: true,
      jobInputTemplate: expect.objectContaining({ sourceRevision: 4 })
    })
    expect(syncTimerMock).toHaveBeenCalledWith(SCHEDULE_ID)
    expect(requestSyncForTriggerMock).not.toHaveBeenCalled()
  })

  it('converges sources of persisted reauthorization-required connections before admission opens', () => {
    seedSource({ scheduleId: SCHEDULE_ID })
    dbh.db
      .update(externalKnowledgeConnectionTable)
      .set({ authorizationStatus: 'reauthorization-required' })
      .where(eq(externalKnowledgeConnectionTable.id, CONNECTION_ID))
      .run()

    lifecycle.reconcilePersistedReauthorization()

    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()).toMatchObject({ state: 'paused', revision: 4 })
    expect(dbh.db.select().from(jobScheduleTable).get()).toMatchObject({ enabled: false })
    expect(requestSyncForTriggerMock).not.toHaveBeenCalled()
  })

  it('turns a valid schedule envelope into a keyed sync request and ignores paused or stale envelopes', async () => {
    seedSource({ scheduleId: SCHEDULE_ID })
    const envelope = {
      baseId: BASE_ID,
      sourceId: SOURCE_ID,
      sourceRevision: 3,
      trigger: 'scheduled' as const,
      dispatch: 'schedule' as const
    }

    await lifecycle.dispatchScheduledEnvelope(envelope, 'startup')
    expect(requestSyncForTriggerMock).toHaveBeenCalledWith({ sourceId: SOURCE_ID }, 'startup')

    await lifecycle.pauseSource(SOURCE_ID)
    await expect(lifecycle.dispatchScheduledEnvelope(envelope, 'scheduled')).resolves.toBeUndefined()
    expect(requestSyncForTriggerMock).toHaveBeenCalledTimes(1)
  })

  it('clears missing and terminal activeJobId references before accepting another trigger', async () => {
    seedSource({ activeJobId: JOB_ID })
    getJobMock.mockResolvedValueOnce(null)

    await expect(lifecycle.reconcileSourceActiveJob(SOURCE_ID)).resolves.toBe('ready')
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBeNull()

    dbh.db.update(externalKnowledgeSourceTable).set({ activeJobId: JOB_ID }).run()
    getJobMock.mockResolvedValueOnce({ id: JOB_ID, status: 'completed' })
    await expect(lifecycle.reconcileSourceActiveJob(SOURCE_ID)).resolves.toBe('ready')
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBeNull()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('settles previous-process non-terminal work through JobManager before clearing the correlation', async () => {
    seedSource({ activeJobId: JOB_ID })
    getJobMock
      .mockResolvedValueOnce({ id: JOB_ID, status: 'running' })
      .mockResolvedValueOnce({ id: JOB_ID, status: 'cancelled' })
    cancelMock.mockResolvedValueOnce({ outcome: 'cancelled' })

    await expect(lifecycle.reconcileSourceActiveJob(SOURCE_ID, { settleNonTerminal: true })).resolves.toBe('ready')

    expect(cancelMock).toHaveBeenCalledWith(JOB_ID, 'External knowledge source startup reconciliation')
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBeNull()
  })

  it('keeps an unsettled previous-process correlation for recovery instead of fabricating a terminal state', async () => {
    seedSource({ activeJobId: JOB_ID })
    getJobMock.mockResolvedValue({ id: JOB_ID, status: 'running' })
    cancelMock.mockResolvedValueOnce({ outcome: 'not-cancellable' })

    await expect(lifecycle.reconcileSourceActiveJob(SOURCE_ID, { settleNonTerminal: true })).resolves.toBe(
      'pending-recovery'
    )

    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBe(JOB_ID)
    expect(dbh.db.select().from(jobTable).all()).toEqual([])
  })

  it('propagates JobManager cancellation failures and preserves the active correlation', async () => {
    seedSource({ activeJobId: JOB_ID })
    getJobMock.mockResolvedValue({ id: JOB_ID, status: 'running' })
    cancelMock.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(lifecycle.reconcileSourceActiveJob(SOURCE_ID, { settleNonTerminal: true })).rejects.toThrow(
      'cancel failed'
    )

    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBe(JOB_ID)
  })

  it('waits for JobManager recovery before startup reconciliation resolves', async () => {
    seedSource({ activeJobId: JOB_ID })
    let recovered = false
    getJobMock.mockImplementation(async () => ({ id: JOB_ID, status: recovered ? 'cancelled' : 'running' }))
    cancelMock.mockResolvedValue({ outcome: 'not-cancellable' })
    const waitForRetry = vi.fn(async () => {
      recovered = true
    })
    const startupLifecycle = new ExternalKnowledgeSourceLifecycle(
      { requestSyncForTrigger: requestSyncForTriggerMock },
      { waitForRetry }
    )

    await startupLifecycle.reconcileAllActiveJobs(new AbortController().signal)

    expect(waitForRetry).toHaveBeenCalledOnce()
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBeNull()
  })

  it('aborts startup reconciliation without leaking its polling wait', async () => {
    seedSource({ activeJobId: JOB_ID })
    getJobMock.mockResolvedValue({ id: JOB_ID, status: 'running' })
    cancelMock.mockResolvedValue({ outcome: 'not-cancellable' })
    const waitForRetry = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const startupLifecycle = new ExternalKnowledgeSourceLifecycle(
      { requestSyncForTrigger: requestSyncForTriggerMock },
      { waitForRetry }
    )
    const controller = new AbortController()
    const reconciliation = startupLifecycle.reconcileAllActiveJobs(controller.signal)
    await vi.waitFor(() => expect(waitForRetry).toHaveBeenCalledOnce())
    const reason = new Error('service stopping')

    controller.abort(reason)

    await expect(reconciliation).rejects.toBe(reason)
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.activeJobId).toBe(JOB_ID)
  })
})
