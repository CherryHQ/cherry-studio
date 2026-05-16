import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { topicTable } from './topic'
import { userModelTable } from './userModel'

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
    // Main content - contains blocks[] (inline JSON)
    data: text({ mode: 'json' }).$type<MessageData>().notNull(),
    // Searchable text extracted from data.parts / legacy data.blocks (populated by trigger, used for FTS5)
    searchableText: text().notNull().default(''),
    // Final status: SUCCESS, ERROR, PAUSED
    status: text().notNull(),
    // Group ID for siblings (0 = normal branch)
    siblingsGroupId: integer().notNull().default(0),
    // Assistant info is derived via topic → assistant FK chain; not stored on message.
    // Model identifier: FK to user_model(id) — UniqueModelId "providerId::modelId"
    modelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    // Snapshot of model at message creation time
    modelSnapshot: text({ mode: 'json' }).$type<ModelSnapshot>(),
    // Trace for tracking
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
 * All statements should be idempotent (IF NOT EXISTS / DROP IF EXISTS / rebuild-safe).
 */
const searchableTextExpression = (dataExpression: string) => `COALESCE((
  SELECT group_concat(text, ' ')
  FROM (
    SELECT json_extract(value, '$.text') AS text
    FROM json_each(json_extract(${dataExpression}, '$.parts'))
    WHERE json_extract(value, '$.type') = 'text'
      AND json_extract(value, '$.text') IS NOT NULL
      AND trim(json_extract(value, '$.text')) != ''

    UNION ALL

    SELECT json_extract(value, '$.data.content') AS text
    FROM json_each(json_extract(${dataExpression}, '$.parts'))
    WHERE json_extract(value, '$.type') IN ('data-code', 'data-translation', 'data-compact')
      AND json_extract(value, '$.data.content') IS NOT NULL
      AND trim(json_extract(value, '$.data.content')) != ''

    UNION ALL

    SELECT json_extract(value, '$.data.compactedContent') AS text
    FROM json_each(json_extract(${dataExpression}, '$.parts'))
    WHERE json_extract(value, '$.type') = 'data-compact'
      AND json_extract(value, '$.data.compactedContent') IS NOT NULL
      AND trim(json_extract(value, '$.data.compactedContent')) != ''

    UNION ALL

    SELECT json_extract(value, '$.data.message') AS text
    FROM json_each(json_extract(${dataExpression}, '$.parts'))
    WHERE json_extract(value, '$.type') = 'data-error'
      AND json_extract(value, '$.data.message') IS NOT NULL
      AND trim(json_extract(value, '$.data.message')) != ''

    UNION ALL

    SELECT json_extract(value, '$.content') AS text
    FROM json_each(json_extract(${dataExpression}, '$.blocks'))
    WHERE json_extract(value, '$.type') = 'main_text'
      AND json_extract(value, '$.content') IS NOT NULL
      AND trim(json_extract(value, '$.content')) != ''
  )
), '')`

export const MESSAGE_FTS_STATEMENTS: string[] = [
  // FTS5 virtual table, Links to message table's searchable_text column
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    searchable_text,
    content='message',
    content_rowid='rowid',
    tokenize='trigram'
  )`,

  // Replace old trigger bodies when the searchable-text expression changes.
  `DROP TRIGGER IF EXISTS message_ai`,
  `DROP TRIGGER IF EXISTS message_ad`,
  `DROP TRIGGER IF EXISTS message_au`,

  // Trigger: populate searchable_text and sync FTS on INSERT.
  // COALESCE wraps group_concat because group_concat returns NULL when no text
  // parts / main_text blocks match (e.g. tool-only or empty messages).
  `CREATE TRIGGER message_ai AFTER INSERT ON message BEGIN
    UPDATE message SET searchable_text = ${searchableTextExpression('NEW.data')} WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
  END`,

  // Trigger: sync FTS on DELETE
  `CREATE TRIGGER message_ad AFTER DELETE ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
  END`,

  // Trigger: update searchable_text and sync FTS on UPDATE OF data.
  // COALESCE: see message_ai above for rationale.
  `CREATE TRIGGER message_au AFTER UPDATE OF data ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
    UPDATE message SET searchable_text = ${searchableTextExpression('NEW.data')} WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
  END`,

  `UPDATE message
   SET searchable_text = ${searchableTextExpression('data')}
   WHERE searchable_text = '' AND deleted_at IS NULL`,

  `INSERT INTO message_fts(message_fts) VALUES ('rebuild')`
]

/** Examples */

/**
 * SQL expression to extract searchable text from data.parts / legacy data.blocks.
 */
// export const SEARCHABLE_TEXT_EXPRESSION = `
//   ${searchableTextExpression('NEW.data')}
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
