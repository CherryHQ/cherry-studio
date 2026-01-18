import type { EmbeddingModelMeta, ItemStatus, KnowledgeItemData, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'
import { sql } from 'drizzle-orm'
import { check, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * knowledge_base table - Knowledge base metadata
 */
export const knowledgeBaseTable = sqliteTable('knowledge_base', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  description: text(),

  // Embedding model configuration
  embeddingModelId: text().notNull(),
  embeddingModelMeta: text({ mode: 'json' }).$type<EmbeddingModelMeta>(),

  // Rerank model configuration
  rerankModelId: text(),
  rerankModelMeta: text({ mode: 'json' }).$type<ModelMeta>(),

  // Preprocessing provider ID
  preprocessProviderId: text(),

  // Configuration
  chunkSize: integer(),
  chunkOverlap: integer(),
  threshold: real(),
  documentCount: integer(),

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

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Unified data field (Discriminated Union)
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // Processing status
    status: text().$type<ItemStatus>().default('idle'),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check(
      'knowledge_item_status_check',
      sql`${t.status} IN ('idle', 'pending', 'ocr', 'read', 'embed', 'completed', 'failed')`
    ),
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`)
  ]
)
