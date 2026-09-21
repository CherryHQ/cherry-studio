import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../../items'
import { ExternalKnowledgeRuntimeError } from '../ExternalKnowledgeRuntime'
import {
  type ExternalKnowledgeSyncDependencies,
  ExternalKnowledgeSourceSyncError,
  ExternalKnowledgeSyncService,
  type SyncExternalKnowledgeDocumentInput
} from '../ExternalKnowledgeSyncService'
import type { FeishuKnowledgeReference, FeishuKnowledgeSourceScanResult } from '../feishuKnowledgeReadAdapter'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d10-7abc-8def-123456789abc'
const OTHER_CONNECTION_ID = '0198f3f2-7d17-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const OTHER_SOURCE_ID = '0198f3f2-7d18-7abc-8def-123456789abc'
const JOB_ID = '0198f3f2-7d12-7abc-8def-123456789abc'
const STAGED_ITEM_ID = '0198f3f2-7d13-7abc-8def-123456789abc'
const OLD_ITEM_ID = '0198f3f2-7d14-7abc-8def-123456789abc'
const OLD_DOCUMENT_ID = '0198f3f2-7d15-7abc-8def-123456789abc'
const SECOND_OLD_ITEM_ID = '0198f3f2-7d20-7abc-8def-123456789abc'
const SECOND_OLD_DOCUMENT_ID = '0198f3f2-7d21-7abc-8def-123456789abc'
const OBSERVED_AT = 1_800_000_000_000
const OLD_CONTENT_HASH = '2e599d46723a6e7f099e12d2bd8f8b8d77a2e043fde6f9a9c8149b204360b2b2'

const reference = (overrides: Partial<FeishuKnowledgeReference['descriptor']> = {}): FeishuKnowledgeReference => ({
  descriptor: {
    remoteObjectId: 'doc-1',
    nodeId: 'node-1',
    parentNodeId: null,
    relativeBreadcrumb: ['Engineering', 'Architecture'],
    title: 'Architecture',
    originalUrl: 'https://example.feishu.cn/wiki/node-1',
    remoteRevision: 'revision-1',
    documentKind: 'document',
    supportState: 'supported',
    ...overrides
  },
  providerData: {
    spaceId: 'space-1',
    nodeToken: 'node-1',
    objToken: 'doc-1',
    objType: 'docx',
    nodeType: 'origin',
    originNodeToken: null,
    originSpaceId: null
  }
})

const preparedMaterial = (item: IndexableKnowledgeItem, text: string) => ({
  item,
  rebuildInput: {
    material: { relativePath: item.data.relativePath! },
    content: { text },
    units: [{ unitType: 'chunk' as const, unitIndex: 0, charStart: 0, charEnd: text.length }],
    usesEmbeddings: false,
    embeddings: []
  }
})

const scanResult = (
  canonicalReferences: FeishuKnowledgeReference[],
  visibleNodeCount = canonicalReferences.length,
  unsupportedOrSkippedCount = 0
): FeishuKnowledgeSourceScanResult => ({ canonicalReferences, visibleNodeCount, unsupportedOrSkippedCount })

describe('ExternalKnowledgeSyncService', () => {
  const dbh = setupTestDatabase()
  const snapshots = new Map<string, string>()
  const materials = new Map<string, unknown>()
  const deletionAdmissions: Array<{ baseId: string; rootItemIds: string[] }> = []
  const recoverDeletingKnowledgeItemsMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    snapshots.clear()
    materials.clear()
    deletionAdmissions.length = 0
    recoverDeletingKnowledgeItemsMock.mockReset()

    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'Engineering KB',
        groupId: null,
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        threshold: null,
        documentCount: null
      })
      .run()
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_example',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'cred-sync-test'
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
        scheduleId: null,
        revision: 3,
        activeJobId: JOB_ID
      })
      .run()
  })

  const createService = (
    content: string,
    dependencyOverrides: Partial<ExternalKnowledgeSyncDependencies> = {},
    readOverride?: (connectionId: string, reference: FeishuKnowledgeReference) => Promise<string>,
    scanOverride?: (connectionId: string) => Promise<FeishuKnowledgeSourceScanResult>,
    lockManager = new KeyedMutex()
  ): ExternalKnowledgeSyncService => {
    const runtime = {
      scanFeishuSource: vi.fn(async (connectionId) =>
        scanOverride ? await scanOverride(connectionId) : scanResult([reference()])
      ),
      readFeishuDocument: vi.fn(async (connectionId, item) => {
        if (readOverride) {
          return {
            descriptor: item.descriptor,
            contentType: 'markdown' as const,
            content: await readOverride(connectionId, item)
          }
        }
        return {
          descriptor: item.descriptor,
          contentType: 'markdown' as const,
          content
        }
      })
    }
    const dependencies: Partial<ExternalKnowledgeSyncDependencies> = {
      createItemId: () => STAGED_ITEM_ID,
      enqueueKnowledgeSubtreeDeletionTx: (_tx, baseId, rootItemIds) => {
        if (rootItemIds.length === 0) return
        deletionAdmissions.push({ baseId, rootItemIds })
      },
      recoverDeletingKnowledgeItems: recoverDeletingKnowledgeItemsMock,
      writeFileIntoKnowledgeBaseAt: async (baseId, relativePath, markdown) => {
        snapshots.set(`${baseId}:${relativePath}`, markdown)
        return relativePath
      },
      prepareKnowledgeMaterial: vi.fn(async ({ item }) => {
        const text = snapshots.get(`${item.baseId}:${item.data.relativePath}`)!
        return preparedMaterial(item, text)
      }),
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => materials.set(itemId, input),
        deleteMaterials: async (itemIds) => itemIds.forEach((itemId) => materials.delete(itemId))
      }),
      now: () => OBSERVED_AT,
      ...dependencyOverrides
    }
    return new ExternalKnowledgeSyncService(runtime, lockManager, dependencies)
  }

  const seedActiveDocument = (overrides: Partial<typeof externalKnowledgeDocumentTable.$inferInsert> = {}) => {
    const relativePath = KnowledgeRelativePathSchema.parse('external/old-document.md')
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: OLD_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: { source: 'Engineering Wiki', title: 'Architecture', relativePath },
        status: 'completed',
        error: null
      })
      .run()
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values({
        id: OLD_DOCUMENT_ID,
        sourceId: SOURCE_ID,
        remoteObjectId: 'doc-1',
        canonicalNodeId: 'node-1',
        parentNodeId: null,
        relativeBreadcrumb: ['Engineering', 'Architecture'],
        title: 'Architecture',
        originalUrl: 'https://example.feishu.cn/wiki/node-1',
        remoteRevision: 'revision-1',
        contentHash: OLD_CONTENT_HASH,
        lastSeenAt: 1,
        availability: 'active',
        knowledgeItemId: OLD_ITEM_ID,
        currentWarning: null,
        ...overrides
      })
      .run()
    snapshots.set(`${BASE_ID}:${relativePath}`, 'old body')
    materials.set(OLD_ITEM_ID, { content: 'old body' })
    return relativePath
  }

  const seedUnavailableDocument = () => {
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values({
        id: OLD_DOCUMENT_ID,
        sourceId: SOURCE_ID,
        remoteObjectId: 'doc-1',
        canonicalNodeId: 'node-1',
        parentNodeId: null,
        relativeBreadcrumb: ['Engineering', 'Architecture'],
        title: 'Architecture',
        originalUrl: 'https://example.feishu.cn/wiki/node-1',
        remoteRevision: 'revision-0',
        contentHash: null,
        lastSeenAt: 1,
        availability: 'unavailable',
        knowledgeItemId: null,
        currentWarning: 'Previously unavailable'
      })
      .run()
  }

  const syncInput = () => ({
    fence: { baseId: BASE_ID, sourceId: SOURCE_ID, expectedSourceRevision: 3, activeJobId: JOB_ID },
    reference: reference(),
    observedAt: OBSERVED_AT,
    signal: new AbortController().signal,
    reportProgress: vi.fn()
  })

  const sourceSyncInput = (signal = new AbortController().signal) => ({
    fence: { baseId: BASE_ID, sourceId: SOURCE_ID, expectedSourceRevision: 3, activeJobId: JOB_ID },
    signal,
    reportProgress: vi.fn()
  })

  const captureSourceError = async (promise: Promise<unknown>): Promise<ExternalKnowledgeSourceSyncError> => {
    try {
      await promise
      throw new Error('Expected source synchronization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalKnowledgeSourceSyncError)
      return error as ExternalKnowledgeSourceSyncError
    }
  }

  it('exposes the source fence as the only source authority', () => {
    type HasIndependentSource = 'source' extends keyof SyncExternalKnowledgeDocumentInput ? true : false

    expectTypeOf<HasIndependentSource>().toEqualTypeOf<false>()
  })

  it('recovers deleting locators for the base before scanning a source', async () => {
    const order: string[] = []
    recoverDeletingKnowledgeItemsMock.mockImplementation(() => order.push('recover'))
    const service = createService('body', {}, undefined, async () => {
      order.push('scan')
      return scanResult([])
    })

    await service.syncSource(sourceSyncInput())

    expect(recoverDeletingKnowledgeItemsMock).toHaveBeenCalledWith(BASE_ID)
    expect(order).toEqual(['recover', 'scan'])
  })

  it('uses the persisted source selected by the fence even when a legacy caller supplies another source', async () => {
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: OTHER_CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_other',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'cred-other'
      })
      .run()
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: OTHER_SOURCE_ID,
        baseId: BASE_ID,
        connectionId: OTHER_CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-other',
        spaceId: 'space-other',
        scope: { kind: 'space' },
        name: 'Other Wiki',
        state: 'active',
        scheduleId: null,
        revision: 3,
        activeJobId: JOB_ID
      })
      .run()
    let readConnectionId: string | null = null
    const service = createService('body', {}, async (connectionId) => {
      readConnectionId = connectionId
      return 'body'
    })
    const input = {
      ...syncInput(),
      source: externalKnowledgeSourceService.getById(OTHER_SOURCE_ID)!
    } as SyncExternalKnowledgeDocumentInput

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'indexed', warnings: [] })
    expect(readConnectionId).toBe(CONNECTION_ID)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ source: 'Engineering Wiki' }) })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ sourceId: SOURCE_ID, remoteObjectId: 'doc-1' })
    ])
  })

  it.each([
    {
      name: 'source revision',
      mutate: () =>
        dbh.db
          .update(externalKnowledgeSourceTable)
          .set({ revision: 4 })
          .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
          .run()
    },
    {
      name: 'active job id',
      mutate: () =>
        dbh.db
          .update(externalKnowledgeSourceTable)
          .set({ activeJobId: '0198f3f2-7d16-7abc-8def-123456789abc' })
          .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
          .run()
    }
  ])('rejects a stale $name fence before reading or staging', async ({ mutate }) => {
    let bodyReads = 0
    let snapshotWrites = 0
    let preparations = 0
    const service = createService(
      'body',
      {
        writeFileIntoKnowledgeBaseAt: async (_baseId, relativePath) => {
          snapshotWrites += 1
          return relativePath
        },
        prepareKnowledgeMaterial: async ({ item }) => {
          preparations += 1
          return preparedMaterial(item, 'body')
        }
      },
      async () => {
        bodyReads += 1
        return 'body'
      }
    )
    mutate()

    const result = await service.syncDocument(syncInput())

    expect(result).toEqual({ outcome: 'skipped', warnings: ['stale-publication'] })
    expect(bodyReads).toBe(0)
    expect(snapshotWrites).toBe(0)
    expect(preparations).toBe(0)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
  })

  it('publishes a new document only after its durable locator, snapshot, and vector material use the same item id', async () => {
    const relativePath = KnowledgeRelativePathSchema.parse(`external/${STAGED_ITEM_ID}.md`)
    let observedBeforeMainCommit = false
    const service = createService('first line\r\nsecond line', {
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => {
          observedBeforeMainCommit =
            itemId === STAGED_ITEM_ID &&
            dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).get()?.status ===
              'deleting' &&
            dbh.db
              .select()
              .from(externalKnowledgeDocumentTable)
              .where(eq(externalKnowledgeDocumentTable.remoteObjectId, 'doc-1'))
              .get() === undefined
          materials.set(itemId, input)
        },
        deleteMaterials: async (itemIds) => itemIds.forEach((itemId) => materials.delete(itemId))
      })
    })

    const result = await service.syncDocument(syncInput())

    expect(result).toEqual({ outcome: 'indexed', warnings: [] })
    expect(observedBeforeMainCommit).toBe(true)
    expect(snapshots.get(`${BASE_ID}:${relativePath}`)).toBe('first line\nsecond line')
    expect(materials.has(STAGED_ITEM_ID)).toBe(true)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({
        id: STAGED_ITEM_ID,
        baseId: BASE_ID,
        type: 'external',
        status: 'completed',
        data: { source: 'Engineering Wiki', title: 'Architecture', relativePath }
      })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        sourceId: SOURCE_ID,
        remoteObjectId: 'doc-1',
        knowledgeItemId: STAGED_ITEM_ID,
        contentHash: '73621482ff083eca9ea88880393298f7d3f53402200780b0c16354a9beb0535a',
        remoteRevision: 'revision-1',
        availability: 'active'
      })
    ])
  })

  it('returns unchanged without reading the body or staging artifacts when a non-null remote revision matches', async () => {
    const oldRelativePath = seedActiveDocument()
    const forbidden = async (): Promise<never> => {
      throw new Error('unchanged content must not be read or prepared')
    }
    const service = createService(
      'unused',
      {
        writeFileIntoKnowledgeBaseAt: forbidden,
        prepareKnowledgeMaterial: forbidden
      },
      forbidden
    )

    const result = await service.syncDocument(syncInput())

    expect(result).toEqual({ outcome: 'unchanged', warnings: [] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, data: expect.objectContaining({ relativePath: oldRelativePath }) })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH, lastSeenAt: OBSERVED_AT })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('updates only the current document and item title when the matching revision has a renamed title', async () => {
    const oldRelativePath = seedActiveDocument()
    const forbidden = async (): Promise<never> => {
      throw new Error('metadata-only sync must not stage content')
    }
    const service = createService(
      'unused',
      {
        writeFileIntoKnowledgeBaseAt: forbidden,
        prepareKnowledgeMaterial: forbidden
      },
      forbidden
    )
    const input = syncInput()
    input.reference = reference({ title: 'Architecture Handbook' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'unchanged', warnings: [] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_ITEM_ID,
        data: { source: 'Engineering Wiki', title: 'Architecture Handbook', relativePath: oldRelativePath }
      })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        knowledgeItemId: OLD_ITEM_ID,
        title: 'Architecture Handbook',
        contentHash: OLD_CONTENT_HASH
      })
    ])
  })

  it('updates canonical path metadata without replacing the matching-revision item', async () => {
    const oldRelativePath = seedActiveDocument()
    const forbidden = async (): Promise<never> => {
      throw new Error('path-only sync must not stage content')
    }
    const service = createService(
      'unused',
      {
        writeFileIntoKnowledgeBaseAt: forbidden,
        prepareKnowledgeMaterial: forbidden
      },
      forbidden
    )
    const input = syncInput()
    input.reference = reference({
      nodeId: 'node-2',
      parentNodeId: 'parent-2',
      relativeBreadcrumb: ['Platform', 'Architecture'],
      originalUrl: 'https://example.feishu.cn/wiki/node-2'
    })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'unchanged', warnings: [] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, data: expect.objectContaining({ relativePath: oldRelativePath }) })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        knowledgeItemId: OLD_ITEM_ID,
        canonicalNodeId: 'node-2',
        parentNodeId: 'parent-2',
        relativeBreadcrumb: ['Platform', 'Architecture'],
        originalUrl: 'https://example.feishu.cn/wiki/node-2',
        contentHash: OLD_CONTENT_HASH
      })
    ])
  })

  it('reads a changed revision but only updates metadata when normalized Markdown has the same hash', async () => {
    const oldRelativePath = seedActiveDocument()
    let bodyReads = 0
    const forbidden = async (): Promise<never> => {
      throw new Error('hash-equal content must not be prepared or published')
    }
    const service = createService(
      'unused',
      { writeFileIntoKnowledgeBaseAt: forbidden, prepareKnowledgeMaterial: forbidden },
      async () => {
        bodyReads += 1
        return 'old body'
      }
    )
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'unchanged', warnings: [] })
    expect(bodyReads).toBe(1)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, data: expect.objectContaining({ relativePath: oldRelativePath }) })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        knowledgeItemId: OLD_ITEM_ID,
        contentHash: OLD_CONTENT_HASH,
        remoteRevision: 'revision-2',
        lastSeenAt: OBSERVED_AT
      })
    ])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('always rereads a null remote revision before deciding the persisted content is unchanged', async () => {
    seedActiveDocument({ remoteRevision: null })
    let bodyReads = 0
    const forbidden = async (): Promise<never> => {
      throw new Error('hash-equal null-revision content must not be prepared or published')
    }
    const service = createService(
      'unused',
      { writeFileIntoKnowledgeBaseAt: forbidden, prepareKnowledgeMaterial: forbidden },
      async () => {
        bodyReads += 1
        return 'old body'
      }
    )
    const input = syncInput()
    input.reference = reference({ remoteRevision: null })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'unchanged', warnings: [] })
    expect(bodyReads).toBe(1)
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH, remoteRevision: null })
    ])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('atomically publishes the replacement and admits durable cleanup for the old owner', async () => {
    const oldRelativePath = seedActiveDocument()
    const newRelativePath = KnowledgeRelativePathSchema.parse(`external/${STAGED_ITEM_ID}.md`)
    let oldOwnerVisibleDuringRebuild = false
    const service = createService('changed body', {
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => {
          const document = dbh.db
            .select()
            .from(externalKnowledgeDocumentTable)
            .where(eq(externalKnowledgeDocumentTable.id, OLD_DOCUMENT_ID))
            .get()
          const oldItem = dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, OLD_ITEM_ID)).get()
          const newItem = dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).get()
          oldOwnerVisibleDuringRebuild =
            document?.knowledgeItemId === OLD_ITEM_ID &&
            oldItem?.status === 'completed' &&
            newItem?.status === 'deleting'
          materials.set(itemId, input)
        },
        deleteMaterials: async (itemIds) => itemIds.forEach((itemId) => materials.delete(itemId))
      })
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'indexed', warnings: [] })
    expect(oldOwnerVisibleDuringRebuild).toBe(true)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'deleting' }),
        expect.objectContaining({
          id: STAGED_ITEM_ID,
          status: 'completed',
          data: { source: 'Engineering Wiki', title: 'Architecture', relativePath: newRelativePath }
        })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_DOCUMENT_ID,
        knowledgeItemId: STAGED_ITEM_ID,
        contentHash: '27be997485d85123b62bee67ecadd99f785523123b6412a69c2d9d8be46ef03d',
        remoteRevision: 'revision-2',
        availability: 'active'
      })
    ])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [OLD_ITEM_ID] }])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(snapshots.get(`${BASE_ID}:${newRelativePath}`)).toBe('changed body')
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID, STAGED_ITEM_ID])
  })

  it('publishes a newly readable version into the existing unavailable document row', async () => {
    seedUnavailableDocument()
    const service = createService('available again')

    const result = await service.syncDocument(syncInput())

    expect(result).toEqual({ outcome: 'indexed', warnings: [] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: STAGED_ITEM_ID, type: 'external', status: 'completed' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_DOCUMENT_ID,
        availability: 'active',
        knowledgeItemId: STAGED_ITEM_ID,
        remoteRevision: 'revision-1',
        currentWarning: null
      })
    ])
  })

  it('leaves the old publication intact when snapshot staging fails', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      writeFileIntoKnowledgeBaseAt: async () => {
        throw new Error('snapshot write failed')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow('snapshot write failed')

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('keeps the staged snapshot locatable and admits cleanup when preparation fails', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async () => {
        throw new Error('prepare failed')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow('prepare failed')

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`, `${BASE_ID}:external/${STAGED_ITEM_ID}.md`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('keeps partially written vector and snapshot artifacts locatable when rebuild fails', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => {
          materials.set(itemId, input)
          throw new Error('rebuild failed')
        },
        deleteMaterials: async (itemIds) => itemIds.forEach((itemId) => materials.delete(itemId))
      })
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow('rebuild failed')

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`, `${BASE_ID}:external/${STAGED_ITEM_ID}.md`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID, STAGED_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('keeps the locator and staged artifacts when the publication transaction fails', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      enqueueKnowledgeSubtreeDeletionTx: (_tx, baseId, rootItemIds) => {
        if (rootItemIds.includes(OLD_ITEM_ID)) throw new Error('publication cleanup admission failed')
        deletionAdmissions.push({ baseId, rootItemIds })
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow('publication cleanup admission failed')

    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, OLD_ITEM_ID)).get()).toMatchObject({
      id: OLD_ITEM_ID,
      status: 'completed'
    })
    expect(
      dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, STAGED_ITEM_ID)).get()
    ).toMatchObject({
      id: STAGED_ITEM_ID,
      status: 'deleting'
    })
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
    expect(snapshots.has(`${BASE_ID}:external/${STAGED_ITEM_ID}.md`)).toBe(true)
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID, STAGED_ITEM_ID])
  })

  it.each([
    {
      name: 'source revision',
      mutate: () =>
        dbh.db
          .update(externalKnowledgeSourceTable)
          .set({ revision: 4 })
          .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
          .run()
    },
    {
      name: 'active job id',
      mutate: () =>
        dbh.db
          .update(externalKnowledgeSourceTable)
          .set({ activeJobId: '0198f3f2-7d16-7abc-8def-123456789abc' })
          .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
          .run()
    }
  ])('skips a staged replacement when the $name fence changes before the base lock', async ({ mutate }) => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async ({ item }) => {
        mutate()
        return preparedMaterial(item, 'changed body')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'skipped', warnings: ['stale-publication'] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`, `${BASE_ID}:external/${STAGED_ITEM_ID}.md`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('skips a staged replacement when the expected document version changes before the base lock', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async ({ item }) => {
        dbh.db
          .update(externalKnowledgeDocumentTable)
          .set({ remoteRevision: 'raced-revision' })
          .where(eq(externalKnowledgeDocumentTable.id, OLD_DOCUMENT_ID))
          .run()
        return preparedMaterial(item, 'changed body')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'skipped', warnings: ['stale-publication'] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, remoteRevision: 'raced-revision' })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`, `${BASE_ID}:external/${STAGED_ITEM_ID}.md`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('keeps the staged locator and artifacts when aborted before the base lock', async () => {
    const oldRelativePath = seedActiveDocument()
    const controller = new AbortController()
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async ({ item }) => {
        controller.abort()
        return preparedMaterial(item, 'changed body')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })
    input.signal = controller.signal

    await expect(service.syncDocument(input)).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`, `${BASE_ID}:external/${STAGED_ITEM_ID}.md`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('does not synchronously purge old artifacts after accepting durable cleanup', async () => {
    const oldRelativePath = seedActiveDocument()
    const newRelativePath = KnowledgeRelativePathSchema.parse(`external/${STAGED_ITEM_ID}.md`)
    const service = createService('changed body', {
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => materials.set(itemId, input),
        deleteMaterials: async (itemIds) => {
          if (itemIds.includes(OLD_ITEM_ID)) throw new Error('old vector cleanup failed')
          itemIds.forEach((itemId) => materials.delete(itemId))
        }
      })
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({ outcome: 'indexed', warnings: [] })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'deleting' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'completed' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: STAGED_ITEM_ID, remoteRevision: 'revision-2' })
    ])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(snapshots.has(`${BASE_ID}:${newRelativePath}`)).toBe(true)
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
    expect(materials.has(STAGED_ITEM_ID)).toBe(true)
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [OLD_ITEM_ID] }])
  })

  it('marks a missing active document unavailable and durably admits artifact cleanup', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('unused', {}, undefined, async () => scanResult([]))

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toEqual({
      scannedCount: 0,
      indexedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      warnings: []
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, status: 'deleting' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_DOCUMENT_ID,
        availability: 'unavailable',
        knowledgeItemId: null,
        contentHash: null,
        remoteRevision: 'revision-1',
        currentWarning: 'source-document-missing'
      })
    ])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [OLD_ITEM_ID] }])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
  })

  it.each([
    ['pagination/transient', new ExternalKnowledgeRuntimeError('transient'), 'transient'],
    ['connection', new ExternalKnowledgeRuntimeError('not-found'), 'not-found'],
    ['credential', new ExternalKnowledgeRuntimeError('credential-unavailable'), 'credential-unavailable'],
    ['scope', new ExternalKnowledgeRuntimeError('scope-missing'), 'scope-missing'],
    ['authentication', new ExternalKnowledgeRuntimeError('reauthorization-required'), 'reauthorization-required'],
    [
      'scope resource permission',
      new ExternalKnowledgeRuntimeError('resource-permission-denied'),
      'resource-permission-denied'
    ],
    ['unknown provider failure', new Error('private provider payload'), 'scan-failed'],
    ['dependency AbortError', new DOMException('private dependency detail', 'AbortError'), 'scan-failed']
  ])('does not reconcile absence after a %s scan failure', async (_name, failure, expectedCode) => {
    seedActiveDocument()
    const service = createService('unused', {}, undefined, async () => {
      throw failure
    })

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe(expectedCode)
    expect(JSON.stringify(error.summary)).not.toContain('private')
    expect(error.summary).toEqual({
      scannedCount: 0,
      indexedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      warnings: []
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
  })

  it('retains a document and records a warning when a read dependency throws AbortError without caller cancellation', async () => {
    seedActiveDocument({ remoteRevision: 'revision-0' })
    const service = createService('unused', {}, async () => {
      throw new DOMException('private dependency detail', 'AbortError')
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toMatchObject({
      indexedCount: 0,
      skippedCount: 1,
      warnings: [{ code: 'document-sync-failed', remoteObjectId: 'doc-1' }]
    })
    expect(JSON.stringify(result)).not.toContain('private dependency detail')
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
  })

  it('classifies a reconciliation dependency AbortError as failure while the caller signal remains active', async () => {
    const lockManager = {
      runExclusive: async () => {
        throw new DOMException('private reconciliation detail', 'AbortError')
      }
    } as unknown as KeyedMutex
    const service = createService('unused', {}, undefined, async () => scanResult([]), lockManager)

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('reconciliation-failed')
    expect(JSON.stringify(error)).not.toContain('private reconciliation detail')
  })

  it('classifies caller cancellation without reconciling absence', async () => {
    seedActiveDocument()
    const controller = new AbortController()
    controller.abort(new DOMException('caller detail', 'AbortError'))
    const service = createService('unused', {}, undefined, async () => scanResult([]))

    const error = await captureSourceError(service.syncSource(sourceSyncInput(controller.signal)))

    expect(error.code).toBe('cancelled')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
  })

  it.each([
    ['connection', 'not-found'],
    ['credential', 'credential-unavailable'],
    ['scope', 'scope-missing'],
    ['authentication', 'reauthorization-required']
  ] as const)('does not reconcile absence after a document read %s failure', async (_name, code) => {
    seedActiveDocument()
    const scannedReference = reference({ remoteObjectId: 'doc-fatal', nodeId: 'node-fatal' })
    const service = createService(
      'unused',
      {},
      async () => {
        throw new ExternalKnowledgeRuntimeError(code)
      },
      async () => scanResult([scannedReference])
    )

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe(code)
    expect(error.summary).toEqual({
      scannedCount: 1,
      indexedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      warnings: []
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
  })

  it('classifies a custom-reason cancellation while waiting for the warning mutation lock', async () => {
    seedActiveDocument({ remoteRevision: 'revision-0' })
    const lockManager = new KeyedMutex()
    let releaseLock!: () => void
    let reportLockHeld!: () => void
    let reportRead!: () => void
    const lockStarted = new Promise<void>((resolve) => {
      reportLockHeld = resolve
    })
    const readStarted = new Promise<void>((resolve) => {
      reportRead = resolve
    })
    const lockHeld = lockManager.runExclusive(BASE_ID, async () => {
      reportLockHeld()
      await new Promise<void>((resolve) => {
        releaseLock = resolve
      })
    })
    await lockStarted
    const controller = new AbortController()
    const service = createService(
      'unused',
      {},
      async () => {
        reportRead()
        throw new ExternalKnowledgeRuntimeError('transient')
      },
      undefined,
      lockManager
    )
    const syncError = captureSourceError(service.syncSource(sourceSyncInput(controller.signal)))
    await readStarted
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort(new Error('private cancellation detail'))
    releaseLock()
    await lockHeld

    const error = await syncError

    expect(error.code).toBe('cancelled')
    expect(JSON.stringify(error.summary)).not.toContain('private cancellation detail')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID, currentWarning: null })
    ])
  })

  it.each([
    ['source revision', { revision: 4 }],
    ['active job', { activeJobId: '0198f3f2-7d16-7abc-8def-123456789abc' }]
  ])('does not reconcile absence with a stale %s fence', async (_name, mutation) => {
    seedActiveDocument()
    dbh.db
      .update(externalKnowledgeSourceTable)
      .set(mutation)
      .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
      .run()
    const service = createService('unused', {}, undefined, async () => scanResult([]))

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('stale-publication')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
  })

  it.each([
    ['source revision', { revision: 4 }],
    ['active job', { activeJobId: '0198f3f2-7d16-7abc-8def-123456789abc' }]
  ])('rolls back zero missing documents when the %s fence changes after scanning', async (_name, mutation) => {
    seedActiveDocument()
    const service = createService('unused', {}, undefined, async () => {
      dbh.db
        .update(externalKnowledgeSourceTable)
        .set(mutation)
        .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
        .run()
      return scanResult([], 4, 1)
    })

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('stale-publication')
    expect(error.summary).toMatchObject({ scannedCount: 4, skippedCount: 1 })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
  })

  it('retains an existing searchable publication and old revision after a transient document read', async () => {
    const oldRelativePath = seedActiveDocument()
    const changedReference = reference({
      nodeId: 'node-2',
      title: 'Architecture renamed',
      remoteRevision: 'revision-2'
    })
    const service = createService(
      'unused',
      {},
      async () => {
        throw new ExternalKnowledgeRuntimeError('transient')
      },
      async () => scanResult([changedReference])
    )

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toEqual({
      scannedCount: 1,
      indexedCount: 0,
      unchangedCount: 0,
      skippedCount: 1,
      warningCount: 1,
      warnings: [{ code: 'transient', remoteObjectId: 'doc-1' }]
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_ITEM_ID,
        data: expect.objectContaining({ title: 'Architecture renamed', relativePath: oldRelativePath })
      })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        knowledgeItemId: OLD_ITEM_ID,
        contentHash: OLD_CONTENT_HASH,
        remoteRevision: 'revision-1',
        canonicalNodeId: 'node-2',
        currentWarning: 'transient'
      })
    ])
    expect(snapshots.get(`${BASE_ID}:${oldRelativePath}`)).toBe('old body')
    expect(materials.get(OLD_ITEM_ID)).toEqual({ content: 'old body' })
  })

  it('treats a changed document owner before warning publication as run-fatal stale state', async () => {
    seedActiveDocument({ remoteRevision: 'revision-0' })
    const lockManager = new KeyedMutex()
    let releaseLock!: () => void
    let reportLockHeld!: () => void
    let reportRead!: () => void
    const lockStarted = new Promise<void>((resolve) => {
      reportLockHeld = resolve
    })
    const readStarted = new Promise<void>((resolve) => {
      reportRead = resolve
    })
    const lockHeld = lockManager.runExclusive(BASE_ID, async () => {
      reportLockHeld()
      await new Promise<void>((resolve) => {
        releaseLock = resolve
      })
    })
    await lockStarted
    const service = createService(
      'unused',
      {},
      async () => {
        reportRead()
        throw new ExternalKnowledgeRuntimeError('transient')
      },
      undefined,
      lockManager
    )
    const syncError = captureSourceError(service.syncSource(sourceSyncInput()))
    await readStarted
    await new Promise<void>((resolve) => setImmediate(resolve))
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: STAGED_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Engineering Wiki',
          title: 'Concurrent owner',
          relativePath: KnowledgeRelativePathSchema.parse('external/concurrent-owner.md')
        },
        status: 'completed',
        error: null
      })
      .run()
    dbh.db
      .update(externalKnowledgeDocumentTable)
      .set({ knowledgeItemId: STAGED_ITEM_ID, contentHash: 'concurrent-hash', remoteRevision: 'concurrent-revision' })
      .where(eq(externalKnowledgeDocumentTable.id, OLD_DOCUMENT_ID))
      .run()
    releaseLock()
    await lockHeld

    const error = await syncError

    expect(error.code).toBe('stale-publication')
    expect(
      dbh.db
        .select()
        .from(externalKnowledgeDocumentTable)
        .where(eq(externalKnowledgeDocumentTable.id, OLD_DOCUMENT_ID))
        .get()
    ).toMatchObject({
      knowledgeItemId: STAGED_ITEM_ID,
      contentHash: 'concurrent-hash',
      remoteRevision: 'concurrent-revision',
      currentWarning: null
    })
  })

  it('does not create rows for a new document with a transient body read failure', async () => {
    const service = createService('unused', {}, async () => {
      throw new ExternalKnowledgeRuntimeError('transient')
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'transient', remoteObjectId: 'doc-1' }])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
    expect(snapshots.size).toBe(0)
    expect(materials.size).toBe(0)
  })

  it('continues after a new document failure and publishes the next canonical document', async () => {
    const failedReference = reference({ remoteObjectId: 'doc-failed', nodeId: 'node-failed', title: 'Failed' })
    const healthyReference = reference({ remoteObjectId: 'doc-healthy', nodeId: 'node-healthy', title: 'Healthy' })
    const service = createService(
      'unused',
      {},
      async (_connectionId, scannedReference) => {
        if (scannedReference.descriptor.remoteObjectId === 'doc-failed') {
          throw new ExternalKnowledgeRuntimeError('transient')
        }
        return 'healthy body'
      },
      async () => scanResult([failedReference, healthyReference])
    )

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toEqual({
      scannedCount: 2,
      indexedCount: 1,
      unchangedCount: 0,
      skippedCount: 1,
      warningCount: 1,
      warnings: [{ code: 'transient', remoteObjectId: 'doc-failed' }]
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ remoteObjectId: 'doc-healthy', knowledgeItemId: STAGED_ITEM_ID })
    ])
  })

  it('withdraws an existing publication and durably admits cleanup only for an explicit permission denial', async () => {
    const oldRelativePath = seedActiveDocument({ remoteRevision: 'revision-0' })
    const service = createService('unused', {}, async () => {
      throw new ExternalKnowledgeRuntimeError('resource-permission-denied')
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'resource-permission-denied', remoteObjectId: 'doc-1' }])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, status: 'deleting' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'unavailable', knowledgeItemId: null, contentHash: null })
    ])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [OLD_ITEM_ID] }])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
  })

  it('does not create rows for a new document with a read permission denial', async () => {
    const service = createService('unused', {}, async () => {
      throw new ExternalKnowledgeRuntimeError('resource-permission-denied')
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'resource-permission-denied', remoteObjectId: 'doc-1' }])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
  })

  it('does not treat a permission-shaped preparation failure as a document read ACL denial', async () => {
    seedActiveDocument({ remoteRevision: 'revision-0' })
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async () => {
        throw new ExternalKnowledgeRuntimeError('resource-permission-denied')
      }
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.warnings).toEqual([{ code: 'document-sync-failed', remoteObjectId: 'doc-1' }])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        availability: 'active',
        knowledgeItemId: OLD_ITEM_ID,
        contentHash: OLD_CONTENT_HASH,
        remoteRevision: 'revision-0',
        currentWarning: 'document-sync-failed'
      })
    ])
  })

  it('retains an existing publication and records a safe warning when preparation fails', async () => {
    const oldRelativePath = seedActiveDocument({ remoteRevision: 'revision-0' })
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async () => {
        throw new Error('private prepared body failure')
      }
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'document-sync-failed', remoteObjectId: 'doc-1' }])
    expect(JSON.stringify(result)).not.toContain('private prepared body failure')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        availability: 'active',
        knowledgeItemId: OLD_ITEM_ID,
        contentHash: OLD_CONTENT_HASH,
        remoteRevision: 'revision-0',
        currentWarning: 'document-sync-failed'
      })
    ])
    expect(snapshots.get(`${BASE_ID}:${oldRelativePath}`)).toBe('old body')
    expect(materials.get(OLD_ITEM_ID)).toEqual({ content: 'old body' })
  })

  it('keeps a durable staging locator when first publication preparation fails', async () => {
    const service = createService('new body', {
      prepareKnowledgeMaterial: async () => {
        throw new Error('private prepared body failure')
      }
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.skippedCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'document-sync-failed', remoteObjectId: 'doc-1' }])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
    expect(snapshots.size).toBe(1)
    expect(materials.size).toBe(0)
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })

  it('preserves the original document failure when staging cleanup admission also fails', async () => {
    const service = createService('new body', {
      prepareKnowledgeMaterial: async () => {
        throw new Error('private prepared body failure')
      },
      enqueueKnowledgeSubtreeDeletionTx: (_tx, _baseId, rootItemIds) => {
        if (rootItemIds.length > 0) throw new Error('private cleanup admission failure')
      }
    })

    const result = await service.syncSource(sourceSyncInput())

    expect(result.warningCount).toBe(1)
    expect(result.warnings).toEqual([{ code: 'document-sync-failed', remoteObjectId: 'doc-1' }])
    expect(JSON.stringify(result)).not.toContain('private')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
  })

  it('does not run missing-document artifact cleanup inline after durable admission', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService(
      'unused',
      {
        getIndexStore: () => {
          throw new Error('inline cleanup must not open the index store')
        }
      },
      undefined,
      async () => scanResult([])
    )

    const result = await service.syncSource(sourceSyncInput())

    expect(result.warnings).toEqual([])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, status: 'deleting' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'unavailable', knowledgeItemId: null })
    ])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
  })

  it('rolls back missing-document withdrawal when durable cleanup admission fails', async () => {
    seedActiveDocument()
    const service = createService(
      'unused',
      {
        enqueueKnowledgeSubtreeDeletionTx: () => {
          throw new Error('cleanup admission failed')
        }
      },
      undefined,
      async () => scanResult([])
    )

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('reconciliation-failed')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
  })

  it('rolls back all missing document visibility and item deletes when one item CAS fails', async () => {
    seedActiveDocument()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: SECOND_OLD_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Engineering Wiki',
          title: 'Second document',
          relativePath: KnowledgeRelativePathSchema.parse('external/second-old-document.md')
        },
        status: 'failed',
        error: 'failed before reconciliation'
      })
      .run()
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values({
        id: SECOND_OLD_DOCUMENT_ID,
        sourceId: SOURCE_ID,
        remoteObjectId: 'doc-2',
        canonicalNodeId: 'node-2',
        parentNodeId: null,
        relativeBreadcrumb: ['Engineering', 'Second document'],
        title: 'Second document',
        originalUrl: 'https://example.feishu.cn/wiki/node-2',
        remoteRevision: 'revision-1',
        contentHash: 'second-content-hash',
        lastSeenAt: 1,
        availability: 'active',
        knowledgeItemId: SECOND_OLD_ITEM_ID,
        currentWarning: null
      })
      .run()
    const service = createService('unused', {}, undefined, async () => scanResult([]))

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('stale-publication')
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
      expect.objectContaining({ id: SECOND_OLD_ITEM_ID, status: 'failed' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ id: OLD_DOCUMENT_ID, availability: 'active', knowledgeItemId: OLD_ITEM_ID }),
      expect.objectContaining({
        id: SECOND_OLD_DOCUMENT_ID,
        availability: 'active',
        knowledgeItemId: SECOND_OLD_ITEM_ID
      })
    ])
  })

  it('uses scan units for summary counts and the canonical remote object for one publication', async () => {
    const service = createService('canonical body', {}, undefined, async () => scanResult([reference()], 3, 2))

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toEqual({
      scannedCount: 3,
      indexedCount: 1,
      unchangedCount: 0,
      skippedCount: 2,
      warningCount: 0,
      warnings: []
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ remoteObjectId: 'doc-1', knowledgeItemId: STAGED_ITEM_ID })
    ])
  })

  it('counts matching published revisions as unchanged alongside unsupported scan references', async () => {
    seedActiveDocument()
    const service = createService('unused', {}, undefined, async () => scanResult([reference()], 3, 2))

    const result = await service.syncSource(sourceSyncInput())

    expect(result).toEqual({
      scannedCount: 3,
      indexedCount: 0,
      unchangedCount: 1,
      skippedCount: 2,
      warningCount: 0,
      warnings: []
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
  })

  it('treats stale publication as run-fatal and skips absence reconciliation', async () => {
    seedActiveDocument({ remoteObjectId: 'missing-doc' })
    const service = createService('new body', {
      prepareKnowledgeMaterial: async ({ item }) => {
        dbh.db
          .update(externalKnowledgeSourceTable)
          .set({ revision: 4 })
          .where(eq(externalKnowledgeSourceTable.id, SOURCE_ID))
          .run()
        return preparedMaterial(item, 'new body')
      }
    })

    const error = await captureSourceError(service.syncSource(sourceSyncInput()))

    expect(error.code).toBe('stale-publication')
    expect(error.summary.scannedCount).toBe(1)
    expect(error.summary.skippedCount).toBe(0)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OLD_ITEM_ID, status: 'completed' }),
        expect.objectContaining({ id: STAGED_ITEM_ID, status: 'deleting' })
      ])
    )
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ remoteObjectId: 'missing-doc', availability: 'active', knowledgeItemId: OLD_ITEM_ID })
    ])
    expect(deletionAdmissions).toEqual([{ baseId: BASE_ID, rootItemIds: [STAGED_ITEM_ID] }])
  })
})
