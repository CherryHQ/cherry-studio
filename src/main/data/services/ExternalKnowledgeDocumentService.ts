import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { application } from '@application'
import {
  type ExternalKnowledgeDocumentRow,
  externalKnowledgeDocumentTable
} from '@data/db/schemas/externalKnowledgeDocument'
import type { DbOrTx } from '@data/db/types'
import type {
  ExternalKnowledgeDocumentListResponse,
  ListExternalKnowledgeDocumentsQuery
} from '@shared/data/api/schemas/externalKnowledge'
import { type ExternalKnowledgeDocument, ExternalKnowledgeDocumentSchema } from '@shared/data/types/externalKnowledge'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

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

  getActiveOwnedKnowledgeItemIds(itemIds: readonly string[], db: DbOrTx = this.db): Set<string> {
    const uniqueItemIds = [...new Set(itemIds)]
    if (uniqueItemIds.length === 0) return new Set()

    const rows = db
      .select({ knowledgeItemId: externalKnowledgeDocumentTable.knowledgeItemId })
      .from(externalKnowledgeDocumentTable)
      .where(
        and(
          eq(externalKnowledgeDocumentTable.availability, 'active'),
          inArray(externalKnowledgeDocumentTable.knowledgeItemId, uniqueItemIds)
        )
      )
      .all()

    return new Set(rows.flatMap((row) => (row.knowledgeItemId === null ? [] : [row.knowledgeItemId])))
  }
}

export const externalKnowledgeDocumentService = new ExternalKnowledgeDocumentService()
