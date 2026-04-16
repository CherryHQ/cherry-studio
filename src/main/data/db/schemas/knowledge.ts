import type {
  KnowledgeItemData,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeSearchMode
} from '@shared/data/types/knowledge'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * knowledge_base table - Knowledge base metadata
 */
export const knowledgeBaseTable = sqliteTable(
  'knowledge_base',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),
    dimensions: integer().notNull(),

    // Embedding model configuration
    embeddingModelId: text().notNull(),

    // Rerank model configuration
    rerankModelId: text(),

    // File processing processor ID
    fileProcessorId: text(),

    // Configuration
    chunkSize: integer(),
    chunkOverlap: integer(),
    threshold: real(),
    documentCount: integer(),
    searchMode: text().$type<KnowledgeSearchMode>(),
    hybridAlpha: real(),

    ...createUpdateTimestamps
  },
  (t) => [
    check(
      'knowledge_base_search_mode_check',
      sql`${t.searchMode} IN ('default', 'bm25', 'hybrid') OR ${t.searchMode} IS NULL`
    )
  ]
)

/**
 * knowledge_item table - Knowledge items (files, URLs, notes, etc.)
 *
 * Uses uuidPrimaryKeyOrdered (UUID v7) because knowledge items are a growing,
 * time-ordered dataset with paginated list queries.
 */
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // Stable business grouping for items from the same source/container.
    // Examples: one directory import, one sitemap expansion, one URL collection.
    groupId: text(),

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Unified data field (Discriminated Union)
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // Processing status
    status: text().$type<KnowledgeItemStatus>().notNull().default('idle'),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`),
    check(
      'knowledge_item_status_check',
      sql`${t.status} IN ('idle', 'pending', 'file_processing', 'read', 'embed', 'completed', 'failed')`
    ),
    // Enforce that group owners live inside the same knowledge base.
    foreignKey({ columns: [t.baseId, t.groupId], foreignColumns: [t.baseId, t.id] }).onDelete('cascade'),
    // Main tab/list query path: same-base items filtered by type and ordered by createdAt.
    index('knowledge_item_base_type_created_idx').on(t.baseId, t.type, t.createdAt),
    // Group result lookups, e.g. show all items from one imported source/container.
    index('knowledge_item_base_group_created_idx').on(t.baseId, t.groupId, t.createdAt),
    // Required by the same-base self-reference on (baseId, groupId) -> (baseId, id).
    unique('knowledge_item_baseId_id_unique').on(t.baseId, t.id)
  ]
)
