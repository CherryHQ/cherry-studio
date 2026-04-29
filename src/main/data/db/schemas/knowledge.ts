import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
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

/**
 * Knowledge base table - stores user-created knowledge-base definitions
 *
 * The database owns durable metadata, grouping, model references, and runtime
 * configuration. Per-base vector indexes/chunks are artifacts managed by
 * KnowledgeRuntimeService, so they are intentionally not represented here.
 */
export const knowledgeBaseTable = sqliteTable(
  'knowledge_base',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),
    emoji: text(),
    dimensions: integer().notNull(),

    // Embedding model FK. SET NULL preserves the base if the model is removed.
    embeddingModelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),

    // Rerank model FK. SET NULL preserves the base if the model is removed.
    rerankModelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),

    // Processor implementation used when extracting content from files.
    fileProcessorId: text(),

    // Runtime configuration read by indexing and search orchestration.
    chunkSize: integer().notNull().default(DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE),
    chunkOverlap: integer().notNull().default(DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP),
    threshold: real(),
    documentCount: integer(),
    searchMode: text().$type<KnowledgeSearchMode>().default(DEFAULT_KNOWLEDGE_SEARCH_MODE),
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
 * Knowledge item table - stores source records inside a knowledge base
 *
 * Items represent user-added files, URLs, notes, and expanded children from
 * directory/sitemap imports. SQLite tracks source identity and processing state;
 * extracted chunks and embeddings live in the per-base vector store.
 *
 * Uses uuidPrimaryKeyOrdered (UUID v7) because items are append-heavy and are
 * commonly listed by creation order.
 */
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // Optional group-owner item id for expanded imports.
    // The composite self-FK below keeps owner and child in the same base.
    groupId: text(),

    // Type: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // Source payload. The shape is selected by type.
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // Runtime processing status and last failure details.
    status: text().$type<KnowledgeItemStatus>().notNull().default('idle'),
    phase: text().$type<KnowledgeItemPhase>(),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`),
    check('knowledge_item_status_check', sql`${t.status} IN ('idle', 'processing', 'completed', 'failed')`),
    check(
      'knowledge_item_phase_check',
      sql`${t.phase} IN ('preparing', 'file_processing', 'reading', 'embedding') OR ${t.phase} IS NULL`
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
