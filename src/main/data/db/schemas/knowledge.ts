import type {
  ItemStatus,
  KnowledgeItemData,
  KnowledgeItemType,
  KnowledgeSearchMode
} from '@shared/data/types/knowledge'
import { foreignKey, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * knowledge_base table - Knowledge base metadata
 */
export const knowledgeBaseTable = sqliteTable('knowledge_base', {
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
})

/**
 * knowledge_item table - Knowledge items (files, URLs, notes, etc.)
 *
 * Uses uuidPrimaryKey (UUID v4) for consistency with existing IDs
 */
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKey(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // Generic same-base tree edge for v2 knowledge items.
    // This is intentionally broader than a directory-only relation so future containers
    // such as sitemap/url groups can reuse the same hierarchy model.
    parentId: text(),

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Unified data field (Discriminated Union)
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // Processing status
    status: text().$type<ItemStatus>().notNull().default('idle'),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    // Covers the current list/query path: same-base children ordered by createdAt.
    index('knowledge_item_base_parent_created_idx').on(t.baseId, t.parentId, t.createdAt),
    unique().on(t.baseId, t.id),
    // Composite self-FK keeps parent/child relationships inside the same knowledge base.
    foreignKey({ columns: [t.baseId, t.parentId], foreignColumns: [t.baseId, t.id] }).onDelete('cascade')
  ]
)
