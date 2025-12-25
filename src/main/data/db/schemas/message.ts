import type { MessageData, MessageStats } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps } from './columnHelpers'
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
    id: text().primaryKey(),
    // FK to topic - CASCADE: delete messages when topic is deleted
    topicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),
    // Adjacency list parent reference for tree structure
    // SET NULL: preserve child messages when parent is deleted
    parentId: text().references(() => messageTable.id, { onDelete: 'set null' }),
    // Group ID for multi-model responses (0 = normal branch)
    responseGroupId: integer().default(0),
    // Message role: user, assistant, system
    role: text().notNull(),
    // Final status: SUCCESS, ERROR, PAUSED
    status: text().notNull(),
    // FK to assistant
    assistantId: text(),
    // Preserved assistant info for display
    assistantMeta: text({ mode: 'json' }),
    // Model identifier
    modelId: text(),
    // Preserved model info (provider, name)
    modelMeta: text({ mode: 'json' }),
    // Main content - contains blocks[], mentions, etc.
    data: text({ mode: 'json' }).$type<MessageData>().notNull(),
    // Statistics: token usage, performance metrics, etc.
    stats: text({ mode: 'json' }).$type<MessageStats>(),
    // Trace ID for tracking
    traceId: text(),
    // Searchable text extracted from data.blocks (populated by trigger, used for FTS5)
    searchableText: text(),
    ...createUpdateDeleteTimestamps
  },
  (t) => [
    // Indexes
    index('message_parent_id_idx').on(t.parentId),
    index('message_topic_created_idx').on(t.topicId, t.createdAt),
    index('message_trace_id_idx').on(t.traceId),
    // Check constraints for enum fields
    check('message_role_check', sql`${t.role} IN ('user', 'assistant', 'system')`),
    check('message_status_check', sql`${t.status} IN ('success', 'error', 'paused')`)
  ]
)
