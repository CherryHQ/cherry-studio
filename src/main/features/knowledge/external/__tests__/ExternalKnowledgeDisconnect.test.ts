import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbOrTx } from '@data/db/types'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { ErrorCode } from '@shared/data/api/errors'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

const { cancelMock, enqueueTxMock, getJobMock, unregisterScheduleMock, notifyDataChangeMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  enqueueTxMock: vi.fn(),
  getJobMock: vi.fn(),
  unregisterScheduleMock: vi.fn(),
  notifyDataChangeMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      enqueueTx: enqueueTxMock,
      get: getJobMock,
      unregisterJobScheduleById: unregisterScheduleMock
    }
  })
})

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataChangeMock }))

const { ExternalKnowledgeDisconnect } = await import('../ExternalKnowledgeDisconnect')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d10-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const DOCUMENT_ID = '0198f3f2-7d12-7abc-8def-123456789abc'
const UNAVAILABLE_DOCUMENT_ID = '0198f3f2-7d13-7abc-8def-123456789abc'
const ITEM_ID = '0198f3f2-7d14-7abc-8def-123456789abc'
const ACTIVE_JOB_ID = '0198f3f2-7d15-7abc-8def-123456789abc'
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222'
const DELETION_JOB_ID = '0198f3f2-7d16-7abc-8def-123456789abc'

describe('ExternalKnowledgeDisconnect', () => {
  const dbh = setupTestDatabase()

  const seedSource = () => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'Knowledge',
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
        credentialReference: 'cred_example',
        accountUserId: 'user-1',
        accountOpenId: 'open-1',
        tenantKey: 'tenant-1',
        grantedScopes: ['wiki:node:read'],
        authorizedAt: 100
      })
      .run()
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: SCHEDULE_ID,
        type: 'knowledge.sync-external-source',
        name: `external-source.${SOURCE_ID}`,
        trigger: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
        jobInputTemplate: { baseId: BASE_ID, sourceId: SOURCE_ID, sourceRevision: 3, trigger: 'scheduled' },
        catchUpPolicy: { kind: 'after-startup', minutes: 0 },
        enabled: true
      })
      .run()
    dbh.db
      .insert(jobTable)
      .values({
        id: ACTIVE_JOB_ID,
        type: 'knowledge.sync-external-source',
        status: 'pending',
        queue: `base.${BASE_ID}`,
        idempotencyKey: `knowledge:${BASE_ID}:external-source:${SOURCE_ID}:sync`,
        scheduledAt: 100,
        input: { baseId: BASE_ID, sourceId: SOURCE_ID, sourceRevision: 3, trigger: 'manual' }
      })
      .run()
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
        state: 'active',
        scheduleId: SCHEDULE_ID,
        revision: 3,
        activeJobId: ACTIVE_JOB_ID,
        lastTrigger: 'manual',
        lastStartedAt: 100
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Feishu Wiki',
          title: 'Architecture',
          relativePath: KnowledgeRelativePathSchema.parse('external/architecture.md')
        },
        status: 'completed',
        error: null
      })
      .run()
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values([
        {
          id: DOCUMENT_ID,
          sourceId: SOURCE_ID,
          remoteObjectId: 'doc-1',
          canonicalNodeId: 'node-1',
          parentNodeId: null,
          relativeBreadcrumb: ['Architecture'],
          title: 'Architecture',
          originalUrl: 'https://example.feishu.cn/wiki/node-1',
          remoteRevision: '1',
          contentHash: 'hash-1',
          lastSeenAt: 100,
          availability: 'active',
          knowledgeItemId: ITEM_ID,
          currentWarning: null
        },
        {
          id: UNAVAILABLE_DOCUMENT_ID,
          sourceId: SOURCE_ID,
          remoteObjectId: 'doc-2',
          canonicalNodeId: 'node-2',
          parentNodeId: null,
          relativeBreadcrumb: ['Unavailable'],
          title: 'Unavailable',
          originalUrl: 'https://example.feishu.cn/wiki/node-2',
          remoteRevision: null,
          contentHash: null,
          lastSeenAt: 100,
          availability: 'unavailable',
          knowledgeItemId: null,
          currentWarning: 'Unavailable'
        }
      ])
      .run()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    seedSource()
    unregisterScheduleMock.mockImplementation(async (scheduleId: string) => {
      const result = dbh.db.delete(jobScheduleTable).where(eq(jobScheduleTable.id, scheduleId)).run()
      return result.changes > 0
    })
    cancelMock.mockImplementation(async (jobId: string) => {
      dbh.db.update(jobTable).set({ status: 'cancelled', finishedAt: 200 }).where(eq(jobTable.id, jobId)).run()
      return { outcome: 'cancelled' }
    })
    getJobMock.mockImplementation(async (jobId: string) =>
      dbh.db.select().from(jobTable).where(eq(jobTable.id, jobId)).limit(1).get()
    )
    enqueueTxMock.mockImplementation((tx: DbOrTx, type: string, input: unknown, options: { queue: string }) => {
      tx.insert(jobTable)
        .values({
          id: DELETION_JOB_ID,
          type,
          status: 'pending',
          queue: options.queue,
          scheduledAt: 200,
          input
        })
        .run()
      return { id: DELETION_JOB_ID, snapshot: {}, finished: Promise.resolve({}) }
    })
  })

  it('keeps completed local content ownerless while deleting the source and every document record', async () => {
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await service.disconnect({ sourceId: SOURCE_ID, mode: 'keep-local' })

    expect(unregisterScheduleMock).toHaveBeenCalledWith(SCHEDULE_ID)
    expect(cancelMock).toHaveBeenCalledWith(ACTIVE_JOB_ID, 'external-knowledge-source-disconnect')
    expect(unregisterScheduleMock.mock.invocationCallOrder[0]).toBeLessThan(cancelMock.mock.invocationCallOrder[0])
    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).get()).toMatchObject({
      id: ITEM_ID,
      status: 'completed'
    })
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('durably marks owned content deleting and enqueues subtree cleanup before removing ownership', async () => {
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await service.disconnect({ sourceId: SOURCE_ID, mode: 'remove-local' })

    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).get()).toMatchObject({
      id: ITEM_ID,
      status: 'deleting'
    })
    expect(dbh.db.select().from(jobTable).where(eq(jobTable.id, DELETION_JOB_ID)).get()).toMatchObject({
      type: 'knowledge.delete-subtree',
      input: { baseId: BASE_ID, rootItemIds: [ITEM_ID] }
    })
    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
  })

  it('leaves the source untouched when schedule unregistering fails', async () => {
    unregisterScheduleMock.mockResolvedValueOnce(false)
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await expect(service.disconnect({ sourceId: SOURCE_ID, mode: 'keep-local' })).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    expect(cancelMock).not.toHaveBeenCalled()
    expect(
      dbh.db.select().from(externalKnowledgeSourceTable).where(eq(externalKnowledgeSourceTable.id, SOURCE_ID)).get()
    ).toMatchObject({ state: 'active', revision: 3, scheduleId: SCHEDULE_ID })
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(2)
  })

  it('stops destructive cleanup when active work cannot settle', async () => {
    cancelMock.mockResolvedValueOnce({ outcome: 'timed-out' })
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await expect(service.disconnect({ sourceId: SOURCE_ID, mode: 'remove-local' })).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    expect(
      dbh.db.select().from(externalKnowledgeSourceTable).where(eq(externalKnowledgeSourceTable.id, SOURCE_ID)).get()
    ).toMatchObject({ state: 'paused', revision: 4, scheduleId: null, activeJobId: ACTIVE_JOB_ID })
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).get()).toMatchObject({
      status: 'completed'
    })
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('rechecks the paused revision after cancellation before destructive cleanup', async () => {
    cancelMock.mockImplementationOnce(async () => {
      dbh.db
        .update(externalKnowledgeSourceTable)
        .set({ revision: 5 })
        .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
        .run()
      return { outcome: 'cancelled' }
    })
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await expect(service.disconnect({ sourceId: SOURCE_ID, mode: 'remove-local' })).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION
    })

    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(jobTable).where(eq(jobTable.id, DELETION_JOB_ID)).get()).toBeUndefined()
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).get()).toMatchObject({
      status: 'completed'
    })
  })

  it('never awaits active job cancellation while holding the base mutex', async () => {
    let lockHeld = false
    const lockManager = {
      runExclusive: vi.fn(async (_key: string, task: () => unknown) => {
        lockHeld = true
        try {
          return await task()
        } finally {
          lockHeld = false
        }
      })
    } as unknown as KeyedMutex
    cancelMock.mockImplementationOnce(async () => {
      expect(lockHeld).toBe(false)
      return { outcome: 'cancelled' }
    })
    const service = new ExternalKnowledgeDisconnect(lockManager)

    await service.disconnect({ sourceId: SOURCE_ID, mode: 'keep-local' })

    expect(lockManager.runExclusive).toHaveBeenCalledTimes(2)
  })

  it('unregisters base schedules without deleting canonical source or document rows', async () => {
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    const sourceIds = await service.prepareExternalSourcesForBaseDeletion(BASE_ID)

    expect(unregisterScheduleMock).toHaveBeenCalledWith(SCHEDULE_ID)
    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toMatchObject([
      { id: SOURCE_ID, scheduleId: null }
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).get()).toMatchObject({
      id: ITEM_ID,
      status: 'completed'
    })
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
    expect(cancelMock).not.toHaveBeenCalled()
    expect(sourceIds).toEqual([SOURCE_ID])

    service.notifyExternalSourcesDeleted(BASE_ID, sourceIds)
    expect(notifyDataChangeMock).toHaveBeenCalled()
  })

  it('keeps base sources and documents when schedule cleanup fails', async () => {
    unregisterScheduleMock.mockResolvedValueOnce(false)
    const service = new ExternalKnowledgeDisconnect(new KeyedMutex())

    await expect(service.prepareExternalSourcesForBaseDeletion(BASE_ID)).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
  })
})
