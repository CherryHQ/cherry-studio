import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { ExternalKnowledgeDocumentAvailability } from '@shared/data/types/externalKnowledge'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { externalKnowledgeSourceTable } from './externalKnowledgeSource'
import { knowledgeItemTable } from './knowledge'

export const externalKnowledgeDocumentTable = sqliteTable(
  'external_knowledge_document',
  {
    id: uuidPrimaryKeyOrdered(),
    sourceId: text()
      .notNull()
      .references(() => externalKnowledgeSourceTable.id, { onDelete: 'cascade' }),
    remoteObjectId: text().notNull(),
    canonicalNodeId: text().notNull(),
    parentNodeId: text(),
    relativeBreadcrumb: text({ mode: 'json' }).$type<string[]>().notNull(),
    title: text().notNull(),
    originalUrl: text().notNull(),
    remoteRevision: text(),
    contentHash: text(),
    lastSeenAt: integer().notNull(),
    availability: text().$type<ExternalKnowledgeDocumentAvailability>().notNull(),
    knowledgeItemId: text().references(() => knowledgeItemTable.id, { onDelete: 'no action' }),
    currentWarning: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('external_knowledge_document_source_remote_object_uq').on(t.sourceId, t.remoteObjectId),
    uniqueIndex('external_knowledge_document_knowledge_item_uq').on(t.knowledgeItemId),
    index('external_knowledge_document_source_availability_idx').on(t.sourceId, t.availability),
    check('external_knowledge_document_availability_check', sql`${t.availability} IN ('active', 'unavailable')`),
    check(
      'external_knowledge_document_ownership_check',
      sql`(${t.availability} = 'active' AND ${t.knowledgeItemId} IS NOT NULL)
          OR (${t.availability} = 'unavailable' AND ${t.knowledgeItemId} IS NULL)`
    ),
    check(
      'external_knowledge_document_identity_nonempty_check',
      sql`length(trim(${t.remoteObjectId})) > 0
          AND length(trim(${t.canonicalNodeId})) > 0
          AND (${t.parentNodeId} IS NULL OR length(trim(${t.parentNodeId})) > 0)
          AND length(trim(${t.title})) > 0
          AND length(trim(${t.originalUrl})) > 0
          AND (${t.remoteRevision} IS NULL OR length(trim(${t.remoteRevision})) > 0)
          AND (${t.contentHash} IS NULL OR length(trim(${t.contentHash})) > 0)
          AND (${t.currentWarning} IS NULL OR length(trim(${t.currentWarning})) > 0)`
    ),
    check(
      'external_knowledge_document_breadcrumb_check',
      sql`json_valid(${t.relativeBreadcrumb}) AND json_type(${t.relativeBreadcrumb}) = 'array'`
    )
  ]
)

export type ExternalKnowledgeDocumentRow = typeof externalKnowledgeDocumentTable.$inferSelect
export type InsertExternalKnowledgeDocumentRow = typeof externalKnowledgeDocumentTable.$inferInsert
