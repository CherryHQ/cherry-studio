import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import type { DbOrTx } from '@data/db/types'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { ErrorCode } from '@shared/data/api/errors'

const { enqueueTxMock, notifyDataChangeMock } = vi.hoisted(() => ({
  enqueueTxMock: vi.fn(),
  notifyDataChangeMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ JobManager: { enqueueTx: enqueueTxMock } })
})

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataChangeMock }))

const { ExternalKnowledgeSyncAdmission } = await import('../ExternalKnowledgeSyncAdmission')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const FAILED_BASE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '0198f3f2-7d10-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const JOB_ID = '0198f3f2-7d12-7abc-8def-123456789abc'

const resolution = {
  provider: 'feishu' as const,
  connectionId: CONNECTION_ID,
  account: { userId: 'user-private', displayName: 'Ada' },
  tenantId: 'tenant-1',
  spaceId: 'space-1',
  scope: { kind: 'space' as const },
  selected: {
    remoteObjectId: 'doc-1',
    nodeId: 'root',
    parentNodeId: null,
    relativeBreadcrumb: ['Root'],
    title: 'Root',
    originalUrl: 'https://acme.feishu.cn/wiki/root',
    remoteRevision: '42',
    documentKind: 'document' as const,
    supportState: 'supported' as const
  }
}

describe('ExternalKnowledgeSyncAdmission', () => {
  const dbh = setupTestDatabase()
  const resolveFeishuScope = vi.fn()

  const seedBase = (id: string, status: 'completed' | 'failed' = 'completed') =>
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id,
        name: `Base ${id}`,
        dimensions: null,
        embeddingModelId: null,
        status,
        error: status === 'failed' ? 'missing_embedding_model' : null,
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()

  const seedConnection = () =>
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_example',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'credential-reference-only'
      })
      .run()

  const seedSource = (state: 'active' | 'paused' = 'active', activeJobId: string | null = null) => {
    if (activeJobId) {
      dbh.db
        .insert(jobTable)
        .values({
          id: activeJobId,
          type: 'knowledge.sync-external-source',
          status: 'pending',
          queue: `base.${BASE_ID}`,
          idempotencyKey: `knowledge:${BASE_ID}:external-source:${SOURCE_ID}:sync`,
          scheduledAt: 100,
          input: { baseId: BASE_ID, sourceId: SOURCE_ID, sourceRevision: 3, trigger: 'initial' }
        })
        .run()
    }
    const [source] = dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: activeJobId ? SOURCE_ID : undefined,
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-1',
        scope: { kind: 'space' },
        name: 'Engineering Wiki',
        state,
        scheduleId: null,
        revision: 3,
        activeJobId,
        lastTrigger: activeJobId ? 'initial' : null,
        lastStartedAt: activeJobId ? 100 : null
      })
      .returning()
      .all()
    return source
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveFeishuScope.mockResolvedValue(resolution)
    enqueueTxMock.mockImplementation(
      (tx: DbOrTx, type: string, input: unknown, options: { queue: string; idempotencyKey?: string }) => {
        const existing = options.idempotencyKey
          ? tx.select().from(jobTable).where(eq(jobTable.idempotencyKey, options.idempotencyKey)).limit(1).get()
          : undefined
        if (!existing) {
          tx.insert(jobTable)
            .values({
              id: JOB_ID,
              type,
              status: 'pending',
              queue: options.queue,
              idempotencyKey: options.idempotencyKey,
              scheduledAt: 123,
              input,
              metadata: {}
            })
            .run()
        }
        return { id: existing?.id ?? JOB_ID, snapshot: {}, finished: Promise.resolve({}) }
      }
    )
    seedBase(BASE_ID)
    seedBase(FAILED_BASE_ID, 'failed')
    seedConnection()
  })

  it('re-resolves the raw URL and atomically creates a source bound to its initial job', async () => {
    const admission = new ExternalKnowledgeSyncAdmission({ resolveFeishuScope }, { now: () => 123 })

    const source = await admission.create({
      baseId: BASE_ID,
      connectionId: CONNECTION_ID,
      url: 'https://acme.feishu.cn/wiki/root?private=ignored',
      name: '  Engineering Wiki  '
    })

    expect(resolveFeishuScope).toHaveBeenCalledWith(CONNECTION_ID, 'https://acme.feishu.cn/wiki/root?private=ignored')
    expect(source).toMatchObject({
      baseId: BASE_ID,
      connectionId: CONNECTION_ID,
      provider: 'feishu',
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      scope: { kind: 'space' },
      name: 'Engineering Wiki',
      revision: 0,
      activeJobId: JOB_ID,
      lastTrigger: 'initial'
    })
    expect(enqueueTxMock).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.sync-external-source',
      { baseId: BASE_ID, sourceId: source.id, sourceRevision: 0, trigger: 'initial' },
      {
        queue: `base.${BASE_ID}`,
        idempotencyKey: `knowledge:${BASE_ID}:external-source:${source.id}:sync`
      }
    )
    expect(notifyDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/knowledge-bases/:id/external-knowledge-sources',
        kind: 'membership',
        routeParams: { id: BASE_ID },
        entityIds: [source.id]
      },
      { endpoint: '/external-knowledge-sources/:id', routeParams: { id: source.id }, entityIds: [source.id] }
    ])
  })

  it('rolls back both the source and enqueued job when binding activeJobId fails', async () => {
    const admission = new ExternalKnowledgeSyncAdmission(
      { resolveFeishuScope },
      {
        now: () => {
          throw new Error('clock failed after enqueue')
        }
      }
    )

    await expect(
      admission.create({
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        url: 'https://acme.feishu.cn/wiki/root',
        name: 'Engineering Wiki'
      })
    ).rejects.toThrow('clock failed after enqueue')

    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toEqual([])
    expect(dbh.db.select().from(jobTable).all()).toEqual([])
    expect(notifyDataChangeMock).not.toHaveBeenCalled()
  })

  it('coalesces manual synchronization without overwriting the original trigger or start time', async () => {
    const seeded = seedSource('active', JOB_ID)
    const admission = new ExternalKnowledgeSyncAdmission({ resolveFeishuScope }, { now: () => 999 })

    const source = await admission.requestSync({ sourceId: seeded.id })

    expect(source).toMatchObject({
      activeJobId: JOB_ID,
      lastTrigger: 'initial',
      lastStartedAt: new Date(100).toISOString()
    })
    expect(enqueueTxMock).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.sync-external-source',
      { baseId: BASE_ID, sourceId: seeded.id, sourceRevision: 3, trigger: 'manual' },
      {
        queue: `base.${BASE_ID}`,
        idempotencyKey: `knowledge:${BASE_ID}:external-source:${seeded.id}:sync`
      }
    )
    expect(dbh.db.select().from(jobTable).where(eq(jobTable.id, JOB_ID)).get()?.input).toEqual({
      baseId: BASE_ID,
      sourceId: seeded.id,
      sourceRevision: 3,
      trigger: 'initial'
    })
    expect(notifyDataChangeMock).not.toHaveBeenCalled()
  })

  it('binds a new manual job and publishes source projection only after commit', async () => {
    const seeded = seedSource()
    const admission = new ExternalKnowledgeSyncAdmission({ resolveFeishuScope }, { now: () => 999 })

    const source = await admission.requestSync({ sourceId: seeded.id })

    expect(source).toMatchObject({
      activeJobId: JOB_ID,
      lastTrigger: 'manual',
      lastStartedAt: new Date(999).toISOString()
    })
    expect(notifyDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/knowledge-bases/:id/external-knowledge-sources',
        kind: 'projection',
        routeParams: { id: BASE_ID },
        entityIds: [seeded.id]
      },
      { endpoint: '/external-knowledge-sources/:id', routeParams: { id: seeded.id }, entityIds: [seeded.id] }
    ])
  })

  it('rejects paused sources and failed bases before enqueuing', async () => {
    const paused = seedSource('paused')
    const failedSource = dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        baseId: FAILED_BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-failed',
        scope: { kind: 'space' },
        name: 'Failed Base Wiki',
        state: 'active',
        scheduleId: null,
        revision: 0
      })
      .returning()
      .get()
    const admission = new ExternalKnowledgeSyncAdmission({ resolveFeishuScope }, { now: () => 999 })

    await expect(admission.requestSync({ sourceId: paused.id })).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
    await expect(admission.requestSync({ sourceId: failedSource.id })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('persists a minimal job row without URL, preview data, provider payload, credentials, or secrets', async () => {
    const secret = 'secret-provider-payload'
    resolveFeishuScope.mockResolvedValue({ ...resolution, providerPayload: { secret } })
    const admission = new ExternalKnowledgeSyncAdmission({ resolveFeishuScope }, { now: () => 123 })

    const source = await admission.create({
      baseId: BASE_ID,
      connectionId: CONNECTION_ID,
      url: 'https://acme.feishu.cn/wiki/root',
      name: 'Engineering Wiki'
    })

    const persisted = externalKnowledgeSourceService.getById(source.id)
    const persistedJob = dbh.db.select().from(jobTable).where(eq(jobTable.id, JOB_ID)).get()
    expect(persistedJob).toMatchObject({
      type: 'knowledge.sync-external-source',
      input: { baseId: BASE_ID, sourceId: source.id, sourceRevision: 0, trigger: 'initial' },
      metadata: {}
    })
    expect(JSON.stringify([persisted, persistedJob])).not.toContain(secret)
    expect(JSON.stringify(persistedJob)).not.toContain('https://acme.feishu.cn')
    expect(JSON.stringify(persistedJob)).not.toContain('preview')
    expect(JSON.stringify(persistedJob)).not.toContain('providerPayload')
    expect(JSON.stringify(persistedJob)).not.toContain('selected')
    expect(JSON.stringify(persistedJob)).not.toContain('credentials')
    expect(JSON.stringify(persistedJob)).not.toContain('user-private')
  })
})
