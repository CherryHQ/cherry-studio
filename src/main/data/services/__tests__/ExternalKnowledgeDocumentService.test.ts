import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  externalKnowledgeDocumentService,
  type ExternalKnowledgeDocumentSyncMetadata
} from '@data/services/ExternalKnowledgeDocumentService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { ErrorCode } from '@shared/data/api/errors'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const FIRST_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab3'
const SECOND_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab4'
const DIRECTORY_ID = '0198f3f2-7d1a-7abc-8def-123456789ab7'
const REPLACEMENT_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab8'
const NEW_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab9'
const JOB_ID = '0198f3f2-7d1a-7abc-8def-123456789aba'
const INVALID_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'

const syncFence = {
  baseId: BASE_ID,
  sourceId: SOURCE_ID,
  expectedSourceRevision: 0,
  activeJobId: JOB_ID
}

describe('ExternalKnowledgeDocumentService', () => {
  const dbh = setupTestDatabase()

  const seedOwnership = () => {
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
        authorizationStatus: 'pending-authorization',
        credentialReference: 'cred_example'
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
        revision: 0,
        activeJobId: JOB_ID
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values(
        [FIRST_ITEM_ID, SECOND_ITEM_ID].map((id, index) => ({
          id,
          baseId: BASE_ID,
          groupId: null,
          type: 'external' as const,
          data: {
            source: 'Feishu Wiki',
            title: `Document ${index + 1}`,
            relativePath: KnowledgeRelativePathSchema.parse(`external/document-${index + 1}.md`)
          },
          status: 'completed' as const,
          error: null
        }))
      )
      .run()
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values([
        {
          id: '0198f3f2-7d1a-7abc-8def-123456789ab5',
          sourceId: SOURCE_ID,
          remoteObjectId: 'doc-1',
          canonicalNodeId: 'node-1',
          parentNodeId: null,
          relativeBreadcrumb: ['Document 1'],
          title: 'Document 1',
          originalUrl: 'https://example.feishu.cn/wiki/node-1',
          remoteRevision: '1',
          contentHash: 'hash-1',
          lastSeenAt: 100,
          availability: 'active',
          knowledgeItemId: FIRST_ITEM_ID,
          currentWarning: null
        },
        {
          id: '0198f3f2-7d1a-7abc-8def-123456789ab6',
          sourceId: SOURCE_ID,
          remoteObjectId: 'doc-2',
          canonicalNodeId: 'node-2',
          parentNodeId: null,
          relativeBreadcrumb: ['Document 2'],
          title: 'Document 2',
          originalUrl: 'https://example.feishu.cn/wiki/node-2',
          remoteRevision: '2',
          contentHash: null,
          lastSeenAt: 200,
          availability: 'unavailable',
          knowledgeItemId: null,
          currentWarning: 'Unavailable from the selected scope'
        }
      ])
      .run()
  }

  it('lists documents newest-first with a stable cursor', () => {
    seedOwnership()

    const firstPage = externalKnowledgeDocumentService.listBySourceId(SOURCE_ID, { limit: 1 })
    expect(firstPage.items.map((item) => item.remoteObjectId)).toEqual(['doc-2'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = externalKnowledgeDocumentService.listBySourceId(SOURCE_ID, {
      cursor: firstPage.nextCursor,
      limit: 1
    })
    expect(secondPage.items.map((item) => item.remoteObjectId)).toEqual(['doc-1'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('reads every source document synchronously without paging', () => {
    seedOwnership()

    expect(
      externalKnowledgeDocumentService.listBySourceIdTx(dbh.db, SOURCE_ID).map((document) => document.remoteObjectId)
    ).toEqual(['doc-1', 'doc-2'])
  })

  it('lists only the knowledge items currently owned by a source for durable cleanup', () => {
    seedOwnership()

    expect(externalKnowledgeDocumentService.listOwnedKnowledgeItemIdsBySourceIdTx(dbh.db, SOURCE_ID)).toEqual([
      FIRST_ITEM_ID
    ])
    expect(
      externalKnowledgeDocumentService.listOwnedKnowledgeItemIdsBySourceIdTx(
        dbh.db,
        '0198f3f2-7d1a-7abc-8def-123456789aff'
      )
    ).toEqual([])
  })

  it('returns only active ownership in one batch and ignores ownerless items', () => {
    seedOwnership()

    expect(
      externalKnowledgeDocumentService.getActiveOwnedKnowledgeItemIds([FIRST_ITEM_ID, SECOND_ITEM_ID, FIRST_ITEM_ID])
    ).toEqual(new Set([FIRST_ITEM_ID]))
    expect(externalKnowledgeDocumentService.getActiveOwnedKnowledgeItemIds([])).toEqual(new Set())
  })

  it('handles ownership admission beyond the SQLite host-parameter limit', () => {
    seedOwnership()
    const missingItemIds = Array.from({ length: 32_767 }, (_, index) => `missing-item-${index}`)

    expect(externalKnowledgeDocumentService.getActiveOwnedKnowledgeItemIds([...missingItemIds, FIRST_ITEM_ID])).toEqual(
      new Set([FIRST_ITEM_ID])
    )
  })

  it('projects deletion blocking onto every listed subtree root in one query', () => {
    seedOwnership()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: DIRECTORY_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'directory',
        data: { source: '/external' },
        status: 'completed',
        error: null
      })
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({ groupId: DIRECTORY_ID })
      .where(eq(knowledgeItemTable.id, FIRST_ITEM_ID))
      .run()

    expect(
      externalKnowledgeDocumentService.getKnowledgeItemIdsWithActiveOwnedSubtree(BASE_ID, [
        DIRECTORY_ID,
        FIRST_ITEM_ID,
        SECOND_ITEM_ID
      ])
    ).toEqual(new Set([DIRECTORY_ID, FIRST_ITEM_ID]))
  })

  it('reads one document and returns null for a missing id', () => {
    seedOwnership()
    const document = externalKnowledgeDocumentService.getById('0198f3f2-7d1a-7abc-8def-123456789ab5')
    expect(document).toMatchObject({ remoteObjectId: 'doc-1', knowledgeItemId: FIRST_ITEM_ID })
    expect(externalKnowledgeDocumentService.getById('0198f3f2-7d1a-7abc-8def-123456789aff')).toBeNull()
  })

  it('finds a remote document only through the expected source and base', () => {
    seedOwnership()

    expect(externalKnowledgeDocumentService.getByRemoteObjectIdTx(dbh.db, BASE_ID, SOURCE_ID, 'doc-1')).toMatchObject({
      remoteObjectId: 'doc-1',
      knowledgeItemId: FIRST_ITEM_ID
    })
    expect(
      externalKnowledgeDocumentService.getByRemoteObjectIdTx(
        dbh.db,
        '22222222-2222-4222-8222-222222222222',
        SOURCE_ID,
        'doc-1'
      )
    ).toBeNull()
  })

  it('creates an active document only while the source sync fence is current', () => {
    seedOwnership()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: NEW_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Feishu Wiki',
          title: 'Document 3',
          relativePath: KnowledgeRelativePathSchema.parse('external/document-3.md')
        },
        status: 'completed',
        error: null
      })
      .run()
    const input = {
      remoteObjectId: 'doc-3',
      canonicalNodeId: 'node-3',
      parentNodeId: null,
      relativeBreadcrumb: ['Document 3'],
      title: 'Document 3',
      originalUrl: 'https://example.feishu.cn/wiki/node-3',
      remoteRevision: '1',
      contentHash: 'hash-3',
      lastSeenAt: 300,
      knowledgeItemId: NEW_ITEM_ID,
      currentWarning: null
    }

    expect(
      externalKnowledgeDocumentService.createActiveTx(dbh.db, { ...syncFence, expectedSourceRevision: 1 }, input)
    ).toBeNull()
    expect(externalKnowledgeDocumentService.createActiveTx(dbh.db, syncFence, input)).toMatchObject({
      sourceId: SOURCE_ID,
      availability: 'active',
      ...input,
      lastSeenAt: new Date(input.lastSeenAt).toISOString()
    })
  })

  it('rejects document ownership by an item that is not a completed external item in the source base', () => {
    seedOwnership()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: INVALID_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'note', content: 'not an external snapshot' },
        status: 'completed',
        error: null
      })
      .run()

    expect(() =>
      externalKnowledgeDocumentService.createActiveTx(dbh.db, syncFence, {
        remoteObjectId: 'doc-invalid',
        canonicalNodeId: 'node-invalid',
        parentNodeId: null,
        relativeBreadcrumb: ['Invalid'],
        title: 'Invalid',
        originalUrl: 'https://example.feishu.cn/wiki/node-invalid',
        remoteRevision: '1',
        contentHash: 'hash-invalid',
        lastSeenAt: 300,
        knowledgeItemId: INVALID_ITEM_ID,
        currentWarning: null
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.INVALID_OPERATION }))
    expect(externalKnowledgeDocumentService.getByRemoteObjectIdTx(dbh.db, BASE_ID, SOURCE_ID, 'doc-invalid')).toBeNull()
  })

  it('updates scan metadata and warnings without prebuilding a missing document', () => {
    seedOwnership()
    const expected = {
      knowledgeItemId: FIRST_ITEM_ID,
      contentHash: 'hash-1',
      remoteRevision: '1'
    }
    const metadata = {
      canonicalNodeId: 'node-1-moved',
      parentNodeId: 'parent-1',
      relativeBreadcrumb: ['Moved', 'Document 1'],
      title: 'Document 1 moved',
      originalUrl: 'https://example.feishu.cn/wiki/node-1-moved',
      remoteRevision: '2',
      lastSeenAt: 300,
      currentWarning: 'Latest content could not be fetched'
    }

    expect(
      externalKnowledgeDocumentService.updateSyncMetadataTx(
        dbh.db,
        { ...syncFence, activeJobId: '0198f3f2-7d1a-7abc-8def-123456789abb' },
        '0198f3f2-7d1a-7abc-8def-123456789ab5',
        expected,
        metadata
      )
    ).toBeNull()
    expect(
      externalKnowledgeDocumentService.updateSyncMetadataTx(
        dbh.db,
        syncFence,
        '0198f3f2-7d1a-7abc-8def-123456789ab5',
        expected,
        metadata
      )
    ).toMatchObject({ ...metadata, lastSeenAt: new Date(metadata.lastSeenAt).toISOString() })

    const beforeCount = dbh.db.select().from(externalKnowledgeDocumentTable).all().length
    expect(
      externalKnowledgeDocumentService.updateSyncMetadataTx(
        dbh.db,
        syncFence,
        '0198f3f2-7d1a-7abc-8def-123456789aff',
        { knowledgeItemId: null, contentHash: null, remoteRevision: null },
        metadata
      )
    ).toBeNull()
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toHaveLength(beforeCount)
  })

  it('updates a current warning without advancing the published revision or content owner', () => {
    seedOwnership()
    const documentId = '0198f3f2-7d1a-7abc-8def-123456789ab5'
    const expected = {
      knowledgeItemId: FIRST_ITEM_ID,
      contentHash: 'hash-1',
      remoteRevision: '1'
    }

    expect(
      externalKnowledgeDocumentService.updateSyncWarningTx(dbh.db, syncFence, documentId, expected, {
        canonicalNodeId: 'node-1-moved',
        parentNodeId: 'parent-1',
        relativeBreadcrumb: ['Moved', 'Document 1'],
        title: 'Document 1 moved',
        originalUrl: 'https://example.feishu.cn/wiki/node-1-moved',
        lastSeenAt: 300,
        currentWarning: 'transient'
      })
    ).toMatchObject({
      canonicalNodeId: 'node-1-moved',
      title: 'Document 1 moved',
      remoteRevision: '1',
      contentHash: 'hash-1',
      knowledgeItemId: FIRST_ITEM_ID,
      currentWarning: 'transient'
    })
  })

  it('projects warning metadata at runtime when a wider object includes publication fields', () => {
    seedOwnership()
    const documentId = '0198f3f2-7d1a-7abc-8def-123456789ab5'
    const widerMetadata = {
      canonicalNodeId: 'node-1-moved',
      parentNodeId: 'parent-1',
      relativeBreadcrumb: ['Moved', 'Document 1'],
      title: 'Document 1 moved',
      originalUrl: 'https://example.feishu.cn/wiki/node-1-moved',
      lastSeenAt: 300,
      currentWarning: 'transient',
      remoteRevision: 'revision-that-must-not-publish',
      contentHash: 'hash-that-must-not-publish',
      knowledgeItemId: SECOND_ITEM_ID
    }

    externalKnowledgeDocumentService.updateSyncWarningTx(
      dbh.db,
      syncFence,
      documentId,
      { knowledgeItemId: FIRST_ITEM_ID, contentHash: 'hash-1', remoteRevision: '1' },
      widerMetadata
    )

    expect(externalKnowledgeDocumentService.getById(documentId)).toMatchObject({
      canonicalNodeId: 'node-1-moved',
      currentWarning: 'transient',
      remoteRevision: '1',
      contentHash: 'hash-1',
      knowledgeItemId: FIRST_ITEM_ID
    })
  })

  it('rolls back every unavailable mark when one ownership compare-and-swap fails', () => {
    seedOwnership()
    const firstDocumentId = '0198f3f2-7d1a-7abc-8def-123456789ab5'
    const secondDocumentId = '0198f3f2-7d1a-7abc-8def-123456789ab6'
    dbh.db
      .update(externalKnowledgeDocumentTable)
      .set({
        availability: 'active',
        knowledgeItemId: SECOND_ITEM_ID,
        contentHash: 'hash-2',
        currentWarning: null
      })
      .where(eq(externalKnowledgeDocumentTable.id, secondDocumentId))
      .run()

    expect(() =>
      dbh.db.transaction((tx) => {
        externalKnowledgeDocumentService.markUnavailableBatchTx(
          tx,
          syncFence,
          [
            {
              documentId: firstDocumentId,
              expected: { knowledgeItemId: FIRST_ITEM_ID, contentHash: 'hash-1', remoteRevision: '1' }
            },
            {
              documentId: secondDocumentId,
              expected: { knowledgeItemId: SECOND_ITEM_ID, contentHash: 'stale-hash', remoteRevision: '2' }
            }
          ],
          'source-document-missing'
        )
      })
    ).toThrow('External knowledge document ownership changed during reconciliation')

    expect(externalKnowledgeDocumentService.getById(firstDocumentId)).toMatchObject({
      availability: 'active',
      knowledgeItemId: FIRST_ITEM_ID,
      contentHash: 'hash-1'
    })
    expect(externalKnowledgeDocumentService.getById(secondDocumentId)).toMatchObject({
      availability: 'active',
      knowledgeItemId: SECOND_ITEM_ID,
      contentHash: 'hash-2'
    })
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([
      expect.objectContaining({ id: FIRST_ITEM_ID }),
      expect.objectContaining({ id: SECOND_ITEM_ID })
    ])
  })

  it('requires every nullable sync metadata field to be explicit', () => {
    expectTypeOf<ExternalKnowledgeDocumentSyncMetadata>().toEqualTypeOf<{
      canonicalNodeId: string
      parentNodeId: string | null
      relativeBreadcrumb: string[]
      title: string
      originalUrl: string
      remoteRevision: string | null
      lastSeenAt: number
      currentWarning: string | null
    }>()
  })

  it('rolls back publication helpers while preserving the durable deleting staging row', () => {
    seedOwnership()
    const createdItemId = '0198f3f2-7d23-7abc-8def-123456789abc'
    knowledgeItemService.createDeletingExternal(BASE_ID, createdItemId, {
      source: 'Feishu Wiki',
      title: 'Rolled back document',
      relativePath: KnowledgeRelativePathSchema.parse('external/rolled-back-document.md')
    })

    expect(() =>
      dbh.db.transaction((tx) => {
        const item = knowledgeItemService.promoteDeletingExternalTx(tx, BASE_ID, createdItemId, {
          source: 'Feishu Wiki',
          title: 'Rolled back document',
          relativePath: KnowledgeRelativePathSchema.parse('external/rolled-back-document.md')
        })
        expect(item).not.toBeNull()
        const document = externalKnowledgeDocumentService.createActiveTx(tx, syncFence, {
          remoteObjectId: 'doc-rollback',
          canonicalNodeId: 'node-rollback',
          parentNodeId: null,
          relativeBreadcrumb: ['Rolled back document'],
          title: 'Rolled back document',
          originalUrl: 'https://example.feishu.cn/wiki/node-rollback',
          remoteRevision: '1',
          contentHash: 'hash-rollback',
          lastSeenAt: 400,
          knowledgeItemId: item!.id,
          currentWarning: null
        })
        expect(document).toMatchObject({ remoteObjectId: 'doc-rollback', knowledgeItemId: item!.id })
        throw new Error('force outer transaction rollback')
      })
    ).toThrow('force outer transaction rollback')

    expect(
      dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, createdItemId)).get()
    ).toMatchObject({ status: 'deleting' })
    expect(
      externalKnowledgeDocumentService.getByRemoteObjectIdTx(dbh.db, BASE_ID, SOURCE_ID, 'doc-rollback')
    ).toBeNull()
  })

  it('publishes and withdraws content only when source and ownership fences still match', () => {
    seedOwnership()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: REPLACEMENT_ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Feishu Wiki',
          title: 'Document 1 replacement',
          relativePath: KnowledgeRelativePathSchema.parse('external/document-1-next.md')
        },
        status: 'completed',
        error: null
      })
      .run()
    const documentId = '0198f3f2-7d1a-7abc-8def-123456789ab5'
    const expected = {
      knowledgeItemId: FIRST_ITEM_ID,
      contentHash: 'hash-1',
      remoteRevision: '1'
    }

    expect(
      externalKnowledgeDocumentService.publishTx(
        dbh.db,
        syncFence,
        documentId,
        {
          ...expected,
          knowledgeItemId: SECOND_ITEM_ID
        },
        {
          knowledgeItemId: REPLACEMENT_ITEM_ID,
          contentHash: 'hash-2',
          remoteRevision: '2'
        }
      )
    ).toBeNull()
    expect(
      externalKnowledgeDocumentService.publishTx(dbh.db, syncFence, documentId, expected, {
        knowledgeItemId: REPLACEMENT_ITEM_ID,
        contentHash: 'hash-2',
        remoteRevision: '2'
      })
    ).toMatchObject({
      availability: 'active',
      knowledgeItemId: REPLACEMENT_ITEM_ID,
      contentHash: 'hash-2',
      remoteRevision: '2',
      currentWarning: null
    })

    expect(
      externalKnowledgeDocumentService.markUnavailableTx(
        dbh.db,
        { ...syncFence, expectedSourceRevision: 1 },
        documentId,
        {
          knowledgeItemId: REPLACEMENT_ITEM_ID,
          contentHash: 'hash-2',
          remoteRevision: '2'
        },
        'Unavailable from the selected Feishu scope'
      )
    ).toBe(false)
    expect(
      externalKnowledgeDocumentService.markUnavailableTx(
        dbh.db,
        syncFence,
        documentId,
        {
          knowledgeItemId: REPLACEMENT_ITEM_ID,
          contentHash: 'hash-2',
          remoteRevision: '2'
        },
        'Unavailable from the selected Feishu scope'
      )
    ).toBe(true)
    expect(externalKnowledgeDocumentService.getById(documentId)).toMatchObject({
      availability: 'unavailable',
      knowledgeItemId: null,
      contentHash: null,
      currentWarning: 'Unavailable from the selected Feishu scope'
    })
  })
})
