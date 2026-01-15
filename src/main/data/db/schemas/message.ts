import type { MessageData, MessageStats } from '@shared/data/types/message'
import type { AssistantMeta, ModelMeta } from '@shared/data/types/meta'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
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
    check('message_status_check', sql`${t.status} IN ('pending', 'success', 'error', 'paused')`)
  ]
)

/**
 * FTS5 SQL statements for message full-text search
 *
 * This file contains SQL statements that must be manually added to migration files.
 * Drizzle does not auto-generate virtual tables or triggers.
 *
 * Architecture:
 * 1. message.searchable_text - regular column populated by trigger
 * 2. message_fts - FTS5 virtual table with external content
 * 3. Triggers sync both searchable_text and FTS5 index
 *
 * Usage:
 * - Copy MESSAGE_FTS_MIGRATION_SQL to migration file when generating migrations
 */

/**
 * Custom SQL statements that Drizzle cannot manage
 * These are executed after every migration via DbService.runCustomMigrations()
 *
 * All statements should use IF NOT EXISTS to be idempotent.
 */
export const MESSAGE_FTS_STATEMENTS: string[] = [
  // FTS5 virtual table, Links to message table's searchable_text column
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    searchable_text,
    content='message',
    content_rowid='rowid',
    tokenize='trigram'
  )`,

  // Trigger: populate searchable_text and sync FTS on INSERT
  `CREATE TRIGGER IF NOT EXISTS message_ai AFTER INSERT ON message BEGIN
    UPDATE message SET searchable_text = (
      SELECT group_concat(json_extract(value, '$.content'), ' ')
      FROM json_each(json_extract(NEW.data, '$.blocks'))
      WHERE json_extract(value, '$.type') = 'main_text'
    ) WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
  END`,

  // Trigger: sync FTS on DELETE
  `CREATE TRIGGER IF NOT EXISTS message_ad AFTER DELETE ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
  END`,

  // Trigger: update searchable_text and sync FTS on UPDATE OF data
  `CREATE TRIGGER IF NOT EXISTS message_au AFTER UPDATE OF data ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
    UPDATE message SET searchable_text = (
      SELECT group_concat(json_extract(value, '$.content'), ' ')
      FROM json_each(json_extract(NEW.data, '$.blocks'))
      WHERE json_extract(value, '$.type') = 'main_text'
    ) WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
  END`
]

/** Examples */

/**
 * SQL expression to extract searchable text from data.blocks
 * Concatenates content from all main_text type blocks
 */
// export const SEARCHABLE_TEXT_EXPRESSION = `
//   (SELECT group_concat(json_extract(value, '$.content'), ' ')
//    FROM json_each(json_extract(NEW.data, '$.blocks'))
//    WHERE json_extract(value, '$.type') = 'main_text')
// `

/**
 * Rebuild FTS index (run manually if needed)
 */
// export const REBUILD_FTS_SQL = `INSERT INTO message_fts(message_fts) VALUES ('rebuild')`

/**
 * Example search query
 */
// export const EXAMPLE_SEARCH_SQL = `
// SELECT m.*
// FROM message m
// JOIN message_fts fts ON m.rowid = fts.rowid
// WHERE message_fts MATCH ?
// ORDER BY rank
// `
