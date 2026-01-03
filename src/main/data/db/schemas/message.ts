import type { MessageData, MessageStats } from '@shared/data/types/message'
import type { AssistantMeta, ModelMeta } from '@shared/data/types/meta'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKeyOrdered } from './columnHelpers'
import { topicTable } from './topic'

/**
 * Message table - stores chat messages with tree structure
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Block content is stored as JSON in the data field.
 * searchableText is a generated column for FTS5 indexing.
 */
export const messageTable = sqliteTable(
  'message',
  {
    id: uuidPrimaryKeyOrdered(),
    // Adjacency list parent reference for tree structure
    parentId: text(),
    // FK to topic - CASCADE: delete messages when topic is deleted
    topicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),
    // Message role: user, assistant, system
    role: text().notNull(),
    // Main content - contains blocks[], mentions, etc.
    data: text({ mode: 'json' }).$type<MessageData>().notNull(),
    // Searchable text extracted from data.blocks (populated by trigger, used for FTS5)
    searchableText: text(),

    // Final status: SUCCESS, ERROR, PAUSED
    status: text().notNull(),

    // Group ID for siblings (0 = normal branch)
    siblingsGroupId: integer().default(0),
    // FK to assistant
    assistantId: text(),
    // Preserved assistant info for display
    assistantMeta: text({ mode: 'json' }).$type<AssistantMeta>(),
    // Model identifier
    modelId: text(),
    // Preserved model info (provider, name)
    modelMeta: text({ mode: 'json' }).$type<ModelMeta>(),
    // Trace ID for tracking

    traceId: text(),
    // Statistics: token usage, performance metrics, etc.
    stats: text({ mode: 'json' }).$type<MessageStats>(),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    // Foreign keys
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
    // Indexes
    index('message_parent_id_idx').on(t.parentId),
    index('message_topic_created_idx').on(t.topicId, t.createdAt),
    index('message_trace_id_idx').on(t.traceId),
    // Check constraints for enum fields
    check('message_role_check', sql`${t.role} IN ('user', 'assistant', 'system')`),
    check('message_status_check', sql`${t.status} IN ('success', 'error', 'paused')`)
  ]
)
