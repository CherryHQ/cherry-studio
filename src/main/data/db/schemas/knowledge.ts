import {
  type KnowledgeBaseStatus,
  type KnowledgeItemData,
  type KnowledgeItemPhase,
  type KnowledgeItemStatus,
  type KnowledgeItemType,
  type KnowledgeSearchMode
} from '@shared/data/types/knowledge'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { groupTable } from './group'
import { userModelTable } from './userModel'

// Durable base metadata; per-base vector stores remain runtime artifacts.
export const knowledgeBaseTable = sqliteTable(
  'knowledge_base',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),
    emoji: text().notNull(),
    dimensions: integer().notNull(),

    embeddingModelId: text().references(() => userModelTable.id),

    status: text().$type<KnowledgeBaseStatus>().notNull().default('completed'),
    error: text(),

    // Preserve the base when an optional rerank model is removed.
    rerankModelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),

    fileProcessorId: text(),

    chunkSize: integer().notNull(),
    chunkOverlap: integer().notNull(),
    threshold: real(),
    documentCount: integer(),
    searchMode: text().$type<KnowledgeSearchMode>().notNull(),
    hybridAlpha: real(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_base_search_mode_check', sql`${t.searchMode} IN ('default', 'bm25', 'hybrid')`),
    check('knowledge_base_status_check', sql`${t.status} IN ('completed', 'failed')`),
    check(
      'knowledge_base_status_error_check',
      sql`
        (
          ${t.status} = 'completed'
          AND ${t.embeddingModelId} IS NOT NULL
          AND ${t.error} IS NULL
        )
        OR (
          ${t.status} = 'failed'
          AND ${t.error} IS NOT NULL
          AND length(trim(${t.error})) > 0
        )
      `
    )
  ]
)

// User-added sources and expanded import children; chunks/embeddings live in the vector store.
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // The composite self-FK below keeps expanded children in the owner's base.
    groupId: text(),

    type: text().$type<KnowledgeItemType>().notNull(),

    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    status: text().$type<KnowledgeItemStatus>().notNull(),
    phase: text().$type<KnowledgeItemPhase>(),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`),
    check('knowledge_item_status_check', sql`${t.status} IN ('idle', 'processing', 'completed', 'failed')`),
    check(
      'knowledge_item_phase_check',
      sql`
        ${t.phase} IS NULL
        OR (${t.type} IN ('file', 'url', 'note') AND ${t.phase} IN ('reading', 'embedding'))
        OR (${t.type} IN ('directory', 'sitemap') AND ${t.phase} = 'preparing')
      `
    ),
    check(
      'knowledge_item_status_phase_error_check',
      sql`
        (
          ${t.status} IN ('idle', 'completed')
          AND ${t.phase} IS NULL
          AND ${t.error} IS NULL
        )
        OR (
          ${t.status} = 'processing'
          AND ${t.error} IS NULL
        )
        OR (
          ${t.status} = 'failed'
          AND ${t.phase} IS NULL
          AND ${t.error} IS NOT NULL
          AND length(trim(${t.error})) > 0
        )
      `
    ),
    // Deletes expanded children when their group-owner item is deleted.
    foreignKey({ columns: [t.baseId, t.groupId], foreignColumns: [t.baseId, t.id] }).onDelete('cascade'),
    // Supports list queries by base/type with stable creation ordering.
    index('knowledge_item_base_type_created_idx').on(t.baseId, t.type, t.createdAt),
    // Supports fetches of all children for a group owner inside a base.
    index('knowledge_item_base_group_created_idx').on(t.baseId, t.groupId, t.createdAt),
    // Required target for the composite self-reference above.
    unique('knowledge_item_baseId_id_unique').on(t.baseId, t.id)
  ]
)
