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
import {
  type ExternalKnowledgeSyncDependencies,
  ExternalKnowledgeSyncService,
  type SyncExternalKnowledgeDocumentInput
} from '../ExternalKnowledgeSyncService'
import type { FeishuKnowledgeReference } from '../feishuKnowledgeReadAdapter'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d10-7abc-8def-123456789abc'
const OTHER_CONNECTION_ID = '0198f3f2-7d17-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d11-7abc-8def-123456789abc'
const OTHER_SOURCE_ID = '0198f3f2-7d18-7abc-8def-123456789abc'
const JOB_ID = '0198f3f2-7d12-7abc-8def-123456789abc'
const STAGED_ITEM_ID = '0198f3f2-7d13-7abc-8def-123456789abc'
const OLD_ITEM_ID = '0198f3f2-7d14-7abc-8def-123456789abc'
const OLD_DOCUMENT_ID = '0198f3f2-7d15-7abc-8def-123456789abc'
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

describe('ExternalKnowledgeSyncService', () => {
  const dbh = setupTestDatabase()
  const snapshots = new Map<string, string>()
  const materials = new Map<string, unknown>()

  beforeEach(() => {
    vi.clearAllMocks()
    snapshots.clear()
    materials.clear()

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
    readOverride?: (connectionId: string) => Promise<string>
  ): ExternalKnowledgeSyncService => {
    const runtime = {
      readFeishuDocument: vi.fn(async (connectionId, item) => {
        if (readOverride) {
          return {
            descriptor: item.descriptor,
            contentType: 'markdown' as const,
            content: await readOverride(connectionId)
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
      writeFileIntoKnowledgeBaseAt: async (baseId, relativePath, markdown) => {
        snapshots.set(`${baseId}:${relativePath}`, markdown)
        return relativePath
      },
      deleteKnowledgeItemFiles: async (baseId, items) => {
        for (const item of items) {
          const relativePath = (item.data as { relativePath: string }).relativePath
          snapshots.delete(`${baseId}:${relativePath}`)
        }
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
      ...dependencyOverrides
    }
    return new ExternalKnowledgeSyncService(runtime, new KeyedMutex(), dependencies)
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

  it('exposes the source fence as the only source authority', () => {
    type HasIndependentSource = 'source' extends keyof SyncExternalKnowledgeDocumentInput ? true : false

    expectTypeOf<HasIndependentSource>().toEqualTypeOf<false>()
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

  it('publishes a new document only after its snapshot and vector material are staged under the same item id', async () => {
    const relativePath = KnowledgeRelativePathSchema.parse(`external/${STAGED_ITEM_ID}.md`)
    let observedBeforeMainCommit = false
    const service = createService('first line\r\nsecond line', {
      getIndexStore: () => ({
        listExistingEmbeddingHashes: () => new Set(),
        rebuildMaterial: (itemId, input) => {
          observedBeforeMainCommit =
            itemId === STAGED_ITEM_ID &&
            dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).get() === undefined &&
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

  it('atomically replaces changed Markdown while the completed old owner stays visible through vector staging', async () => {
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
            document?.knowledgeItemId === OLD_ITEM_ID && oldItem?.status === 'completed' && newItem === undefined
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
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({
        id: STAGED_ITEM_ID,
        status: 'completed',
        data: { source: 'Engineering Wiki', title: 'Architecture', relativePath: newRelativePath }
      })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({
        id: OLD_DOCUMENT_ID,
        knowledgeItemId: STAGED_ITEM_ID,
        contentHash: '27be997485d85123b62bee67ecadd99f785523123b6412a69c2d9d8be46ef03d',
        remoteRevision: 'revision-2',
        availability: 'active'
      })
    ])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(false)
    expect(snapshots.get(`${BASE_ID}:${newRelativePath}`)).toBe('changed body')
    expect([...materials.keys()]).toEqual([STAGED_ITEM_ID])
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

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: OLD_ITEM_ID, data: expect.objectContaining({ relativePath: oldRelativePath }) })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('removes the staged snapshot and leaves the old publication intact when preparation fails', async () => {
    const oldRelativePath = seedActiveDocument()
    const service = createService('changed body', {
      prepareKnowledgeMaterial: async () => {
        throw new Error('prepare failed')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow('prepare failed')

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('compensates a partially written new vector and snapshot when rebuild fails', async () => {
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

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('rolls back visibility and compensates new artifacts when the main database transaction fails', async () => {
    const oldRelativePath = seedActiveDocument()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: STAGED_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'conflicting item', content: 'conflict' },
        status: 'completed',
        error: null
      })
      .run()
    const service = createService('changed body')
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    await expect(service.syncDocument(input)).rejects.toThrow()

    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect(dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, OLD_ITEM_ID)).get()).toMatchObject({
      id: OLD_ITEM_ID,
      status: 'completed'
    })
    expect(snapshots.has(`${BASE_ID}:external/${STAGED_ITEM_ID}.md`)).toBe(false)
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
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
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
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
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, remoteRevision: 'raced-revision' })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('compensates the staged snapshot and preserves the old publication when aborted before the base lock', async () => {
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

    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([expect.objectContaining({ id: OLD_ITEM_ID })])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: OLD_ITEM_ID, contentHash: OLD_CONTENT_HASH })
    ])
    expect([...snapshots.keys()]).toEqual([`${BASE_ID}:${oldRelativePath}`])
    expect([...materials.keys()]).toEqual([OLD_ITEM_ID])
  })

  it('keeps the committed replacement visible and reports warnings when old artifact cleanup fails', async () => {
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
      }),
      deleteKnowledgeItemFiles: async (_baseId, items) => {
        if (items.some((item) => item.id === OLD_ITEM_ID)) throw new Error('old snapshot cleanup failed')
      }
    })
    const input = syncInput()
    input.reference = reference({ remoteRevision: 'revision-2' })

    const result = await service.syncDocument(input)

    expect(result).toEqual({
      outcome: 'indexed',
      warnings: ['old-vector-cleanup-failed', 'old-snapshot-cleanup-failed']
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: STAGED_ITEM_ID, status: 'completed' })
    ])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([
      expect.objectContaining({ knowledgeItemId: STAGED_ITEM_ID, remoteRevision: 'revision-2' })
    ])
    expect(snapshots.has(`${BASE_ID}:${oldRelativePath}`)).toBe(true)
    expect(snapshots.has(`${BASE_ID}:${newRelativePath}`)).toBe(true)
    expect(materials.has(OLD_ITEM_ID)).toBe(true)
    expect(materials.has(STAGED_ITEM_ID)).toBe(true)
  })
})
