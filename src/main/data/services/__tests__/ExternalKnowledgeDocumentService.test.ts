import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeDocumentService } from '@data/services/ExternalKnowledgeDocumentService'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const FIRST_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab3'
const SECOND_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab4'
const DIRECTORY_ID = '0198f3f2-7d1a-7abc-8def-123456789ab7'

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
        revision: 0
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
})
