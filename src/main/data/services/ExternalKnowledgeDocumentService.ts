import { and, eq, exists, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import { application } from '@application'
import {
  type ExternalKnowledgeDocumentRow,
  externalKnowledgeDocumentTable
} from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx, DbType } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  ExternalKnowledgeDocumentListResponse,
  ListExternalKnowledgeDocumentsQuery
} from '@shared/data/api/schemas/externalKnowledge'
import { type ExternalKnowledgeDocument, ExternalKnowledgeDocumentSchema } from '@shared/data/types/externalKnowledge'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

// Stay below SQLite host-parameter limits across builds and leave room for other bound values.
const SQLITE_INARRAY_CHUNK = 500

export type ExternalKnowledgeSourceSyncFence = {
  baseId: string
  sourceId: string
  expectedSourceRevision: number
  activeJobId: string
}

export type ExternalKnowledgeDocumentVersion = Pick<
  ExternalKnowledgeDocumentRow,
  'knowledgeItemId' | 'contentHash' | 'remoteRevision'
>

export type ExternalKnowledgeDocumentSyncMetadata = Pick<
  ExternalKnowledgeDocumentRow,
  | 'canonicalNodeId'
  | 'parentNodeId'
  | 'relativeBreadcrumb'
  | 'title'
  | 'originalUrl'
  | 'remoteRevision'
  | 'lastSeenAt'
  | 'currentWarning'
>

export type CreateActiveExternalKnowledgeDocumentInput = ExternalKnowledgeDocumentSyncMetadata & {
  remoteObjectId: string
  contentHash: string
  knowledgeItemId: string
}

export type PublishExternalKnowledgeDocumentInput = {
  knowledgeItemId: string
  contentHash: string
  remoteRevision: string | null
}

function rowToEntity(row: ExternalKnowledgeDocumentRow): ExternalKnowledgeDocument {
  return ExternalKnowledgeDocumentSchema.parse({
    ...row,
    lastSeenAt: timestampToISO(row.lastSeenAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

export class ExternalKnowledgeDocumentService {
  private get db() {
    return application.get('DbService').getDb()
  }

  listBySourceId(sourceId: string, query: ListExternalKnowledgeDocumentsQuery): ExternalKnowledgeDocumentListResponse {
    const filter = eq(externalKnowledgeDocumentTable.sourceId, sourceId)
    const conditions: SQL[] = [filter]
    const ordering = keysetOrdering(externalKnowledgeDocumentTable.lastSeenAt, externalKnowledgeDocumentTable.id, {
      major: 'desc',
      tie: 'asc'
    })
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'external-knowledge-document')
    if (cursor) conditions.push(ordering.where(cursor))

    const rows = this.db
      .select()
      .from(externalKnowledgeDocumentTable)
      .where(and(...conditions))
      .orderBy(...ordering.orderBy)
      .limit(query.limit + 1)
      .all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(externalKnowledgeDocumentTable)
      .where(filter)
      .all()
    const pageRows = rows.slice(0, query.limit)

    return {
      items: pageRows.map(rowToEntity),
      total: count,
      nextCursor:
        rows.length > query.limit
          ? encodeCursor(pageRows[pageRows.length - 1].lastSeenAt, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): ExternalKnowledgeDocument | null {
    const row = this.db
      .select()
      .from(externalKnowledgeDocumentTable)
      .where(eq(externalKnowledgeDocumentTable.id, id))
      .limit(1)
      .get()
    return row ? rowToEntity(row) : null
  }

  getByRemoteObjectIdTx(
    tx: Pick<DbType, 'select'>,
    baseId: string,
    sourceId: string,
    remoteObjectId: string
  ): ExternalKnowledgeDocument | null {
    const row = tx
      .select({ document: externalKnowledgeDocumentTable })
      .from(externalKnowledgeDocumentTable)
      .innerJoin(
        externalKnowledgeSourceTable,
        eq(externalKnowledgeSourceTable.id, externalKnowledgeDocumentTable.sourceId)
      )
      .where(
        and(
          eq(externalKnowledgeSourceTable.baseId, baseId),
          eq(externalKnowledgeDocumentTable.sourceId, sourceId),
          eq(externalKnowledgeDocumentTable.remoteObjectId, remoteObjectId)
        )
      )
      .limit(1)
      .get()
    return row ? rowToEntity(row.document) : null
  }

  createActiveTx(
    tx: Pick<DbType, 'select' | 'insert'>,
    fence: ExternalKnowledgeSourceSyncFence,
    input: CreateActiveExternalKnowledgeDocumentInput
  ): ExternalKnowledgeDocument | null {
    if (!this.matchesSourceFenceTx(tx, fence)) return null
    this.assertPublishableItemTx(tx, fence.baseId, input.knowledgeItemId)

    const [row] = withSqliteErrors(
      () =>
        tx
          .insert(externalKnowledgeDocumentTable)
          .values({ ...input, sourceId: fence.sourceId, availability: 'active' })
          .returning()
          .all(),
      defaultHandlersFor('ExternalKnowledgeDocument', `${fence.sourceId}:${input.remoteObjectId}`)
    )
    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeDocument', 'Document create result missing')
    }
    return rowToEntity(row)
  }

  updateSyncMetadataTx(
    tx: Pick<DbType, 'select' | 'update'>,
    fence: ExternalKnowledgeSourceSyncFence,
    documentId: string,
    expected: ExternalKnowledgeDocumentVersion,
    metadata: ExternalKnowledgeDocumentSyncMetadata
  ): ExternalKnowledgeDocument | null {
    const [row] = tx
      .update(externalKnowledgeDocumentTable)
      .set(metadata)
      .where(this.documentFence(tx, fence, documentId, expected))
      .returning()
      .all()
    return row ? rowToEntity(row) : null
  }

  publishTx(
    tx: Pick<DbType, 'select' | 'update'>,
    fence: ExternalKnowledgeSourceSyncFence,
    documentId: string,
    expected: ExternalKnowledgeDocumentVersion,
    publication: PublishExternalKnowledgeDocumentInput
  ): ExternalKnowledgeDocument | null {
    if (!this.matchesDocumentFenceTx(tx, fence, documentId, expected)) return null
    this.assertPublishableItemTx(tx, fence.baseId, publication.knowledgeItemId)

    const [row] = tx
      .update(externalKnowledgeDocumentTable)
      .set({ ...publication, availability: 'active', currentWarning: null })
      .where(this.documentFence(tx, fence, documentId, expected))
      .returning()
      .all()
    return row ? rowToEntity(row) : null
  }

  markUnavailableTx(
    tx: Pick<DbType, 'select' | 'update'>,
    fence: ExternalKnowledgeSourceSyncFence,
    documentId: string,
    expected: ExternalKnowledgeDocumentVersion,
    currentWarning: string
  ): boolean {
    const result = tx
      .update(externalKnowledgeDocumentTable)
      .set({ availability: 'unavailable', knowledgeItemId: null, contentHash: null, currentWarning })
      .where(this.documentFence(tx, fence, documentId, expected))
      .run()
    return result.changes > 0
  }

  getActiveOwnedKnowledgeItemIds(itemIds: readonly string[], db: DbOrTx = this.db): Set<string> {
    const uniqueItemIds = [...new Set(itemIds)]
    if (uniqueItemIds.length === 0) return new Set()

    const ownedItemIds = new Set<string>()
    for (let index = 0; index < uniqueItemIds.length; index += SQLITE_INARRAY_CHUNK) {
      const rows = db
        .select({ knowledgeItemId: externalKnowledgeDocumentTable.knowledgeItemId })
        .from(externalKnowledgeDocumentTable)
        .where(
          and(
            eq(externalKnowledgeDocumentTable.availability, 'active'),
            inArray(
              externalKnowledgeDocumentTable.knowledgeItemId,
              uniqueItemIds.slice(index, index + SQLITE_INARRAY_CHUNK)
            )
          )
        )
        .all()

      for (const row of rows) {
        if (row.knowledgeItemId !== null) ownedItemIds.add(row.knowledgeItemId)
      }
    }

    return ownedItemIds
  }

  getKnowledgeItemIdsWithActiveOwnedSubtree(
    baseId: string,
    rootItemIds: readonly string[],
    db: DbOrTx = this.db
  ): Set<string> {
    const uniqueRootIds = [...new Set(rootItemIds)]
    if (uniqueRootIds.length === 0) return new Set()

    const rows = db.all<{ rootId: string }>(sql`
      WITH RECURSIVE subtree(root_id, item_id) AS (
        SELECT id, id
        FROM ${knowledgeItemTable}
        WHERE base_id = ${baseId}
          AND id IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})

        UNION ALL

        SELECT subtree.root_id, child.id
        FROM ${knowledgeItemTable} child
        INNER JOIN subtree ON child.group_id = subtree.item_id
        WHERE child.base_id = ${baseId}
      )
      SELECT DISTINCT subtree.root_id AS "rootId"
      FROM subtree
      INNER JOIN ${externalKnowledgeDocumentTable} document
        ON document.knowledge_item_id = subtree.item_id
      WHERE document.availability = 'active'
    `)

    return new Set(rows.map((row) => row.rootId))
  }

  private matchesSourceFenceTx(tx: Pick<DbType, 'select'>, fence: ExternalKnowledgeSourceSyncFence): boolean {
    return Boolean(
      tx
        .select({ id: externalKnowledgeSourceTable.id })
        .from(externalKnowledgeSourceTable)
        .where(this.sourceFence(fence))
        .limit(1)
        .get()
    )
  }

  private sourceFenceExists(tx: Pick<DbType, 'select'>, fence: ExternalKnowledgeSourceSyncFence): SQL {
    return exists(
      tx
        .select({ id: externalKnowledgeSourceTable.id })
        .from(externalKnowledgeSourceTable)
        .where(this.sourceFence(fence))
    )
  }

  private sourceFence(fence: ExternalKnowledgeSourceSyncFence): SQL {
    return and(
      eq(externalKnowledgeSourceTable.id, fence.sourceId),
      eq(externalKnowledgeSourceTable.baseId, fence.baseId),
      eq(externalKnowledgeSourceTable.revision, fence.expectedSourceRevision),
      eq(externalKnowledgeSourceTable.activeJobId, fence.activeJobId)
    )!
  }

  private documentFence(
    tx: Pick<DbType, 'select'>,
    fence: ExternalKnowledgeSourceSyncFence,
    documentId: string,
    expected: ExternalKnowledgeDocumentVersion
  ): SQL {
    return and(
      eq(externalKnowledgeDocumentTable.id, documentId),
      eq(externalKnowledgeDocumentTable.sourceId, fence.sourceId),
      ...this.ownershipFence(expected),
      this.sourceFenceExists(tx, fence)
    )!
  }

  private matchesDocumentFenceTx(
    tx: Pick<DbType, 'select'>,
    fence: ExternalKnowledgeSourceSyncFence,
    documentId: string,
    expected: ExternalKnowledgeDocumentVersion
  ): boolean {
    return Boolean(
      tx
        .select({ id: externalKnowledgeDocumentTable.id })
        .from(externalKnowledgeDocumentTable)
        .where(this.documentFence(tx, fence, documentId, expected))
        .limit(1)
        .get()
    )
  }

  private assertPublishableItemTx(tx: Pick<DbType, 'select'>, baseId: string, knowledgeItemId: string): void {
    const item = tx
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(
        and(
          eq(knowledgeItemTable.id, knowledgeItemId),
          eq(knowledgeItemTable.baseId, baseId),
          eq(knowledgeItemTable.type, 'external'),
          eq(knowledgeItemTable.status, 'completed')
        )
      )
      .limit(1)
      .get()
    if (!item) {
      throw DataApiErrorFactory.invalidOperation(
        'publish external knowledge document',
        'knowledge item must be a completed external item in the source knowledge base'
      )
    }
  }

  private ownershipFence(expected: ExternalKnowledgeDocumentVersion): SQL[] {
    return [
      expected.knowledgeItemId === null
        ? isNull(externalKnowledgeDocumentTable.knowledgeItemId)
        : eq(externalKnowledgeDocumentTable.knowledgeItemId, expected.knowledgeItemId),
      expected.contentHash === null
        ? isNull(externalKnowledgeDocumentTable.contentHash)
        : eq(externalKnowledgeDocumentTable.contentHash, expected.contentHash),
      expected.remoteRevision === null
        ? isNull(externalKnowledgeDocumentTable.remoteRevision)
        : eq(externalKnowledgeDocumentTable.remoteRevision, expected.remoteRevision)
    ]
  }
}

export const externalKnowledgeDocumentService = new ExternalKnowledgeDocumentService()
