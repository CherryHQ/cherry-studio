import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { topicTable } from './topic'
import { userModelTable } from './userModel'

/**
 * Message table - stores chat messages with tree structure
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Message content (AI SDK UIMessage parts) is stored as JSON in the data field.
 * searchableText is a plain column populated by triggers for FTS5 indexing
 * (NOT a SQLite GENERATED column); see MESSAGE_FTS_STATEMENTS below.
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
    // Main content - contains AI SDK UIMessage.parts (inline JSON)
    data: text({ mode: 'json' }).$type<MessageData>().notNull(),
    // Searchable text extracted from data.parts (populated by trigger, used for FTS5)
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
    // Statistics: token usage, performance metrics, etc.
    stats: text({ mode: 'json' }).$type<MessageStats>(),

    // Stable integer surrogate for the FTS5 content_rowid. Local-only physical identity
    // (like rowid): assigned by the AFTER INSERT trigger, never set by app code, never
    // exported in backups. Nullable because the trigger fills it after the row is inserted
    // (a NOT NULL column would reject the row before the trigger runs).
    ftsRowid: integer(),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    // Foreign keys
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
    // Indexes
    index('message_parent_id_idx').on(t.parentId),
    index('message_topic_created_idx').on(t.topicId, t.createdAt),
    // Backs findPendingAssistantMessageIds (boot reconcile); without it that lookup full-SCANs.
    // Plain, not partial — Drizzle binds `status = ?`, which SQLite can't match to a partial index.
    index('message_status_idx').on(t.status),
    // Single-root invariant: at most one live virtual-root (parentId IS NULL) row per topic.
    // Guarantees one root and backs O(1) root lookup (WHERE topic_id=? AND parent_id IS NULL).
    // Scoped to deleted_at IS NULL so a future soft-delete of a root can't collide with a
    // freshly created one (getRootMessageIdTx filters deleted_at to match).
    uniqueIndex('message_topic_root_uniq')
      .on(t.topicId)
      .where(sql`${t.parentId} is null and ${t.deletedAt} is null`),
    // FTS5 content_rowid key (see the fts_rowid column). UNIQUE so its backing index makes the
    // per-row `MAX(fts_rowid)+1` assignment in the FTS INSERT trigger an O(log N) lookup (a bare
    // column would make a bulk migration O(N²)), and rejects any duplicate value loudly.
    uniqueIndex('message_fts_rowid_uniq').on(t.ftsRowid),
    // Check constraints for enum fields
    check('message_role_check', sql`${t.role} IN ('user', 'assistant', 'system', 'root')`),
    check('message_status_check', sql`${t.status} IN ('pending', 'success', 'error', 'paused')`),
    // Structural role↔null coupling: the virtual root (role='root') is the only row with a
    // null parent, and every content row must have a parent. Makes "content always has a
    // parent" and "root ⇔ parentId IS NULL" DB invariants, not service-layer discipline.
    check('message_root_parent_check', sql`(${t.role} = 'root') = (${t.parentId} is null)`)
  ]
)

export type MessageRow = typeof messageTable.$inferSelect
export type InsertMessageRow = typeof messageTable.$inferInsert

/**
 * FTS5 SQL statements for message full-text search
 *
 * This file contains SQL statements that must be manually added to migration files.
 * Drizzle does not auto-generate virtual tables or triggers.
 *
 * Architecture:
 * 1. message.fts_rowid - stable integer key for FTS (assigned by trigger; see the column)
 * 2. message.searchable_text - regular column populated by trigger
 * 3. message_fts - FTS5 external-content virtual table keyed on fts_rowid (NOT implicit rowid)
 * 4. Triggers assign fts_rowid and sync both searchable_text and the FTS index
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

  )
), '')`

export const MESSAGE_FTS_STATEMENTS: string[] = [
  // FTS5 external-content virtual table keyed on the stable `fts_rowid` column, NOT the implicit
  // rowid: the implicit rowid is reshuffled by table rebuilds (drizzle's INSERT...SELECT drops it)
  // and by VACUUM, which would silently desync this index. `fts_rowid` is a real column carried
  // verbatim through rebuilds, so the index stays aligned by construction.
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    searchable_text,
    content='message',
    content_rowid='fts_rowid',
    tokenize='trigram'
  )`,

  // Replace old trigger bodies when the searchable-text expression or fts_rowid wiring changes.
  `DROP TRIGGER IF EXISTS message_ai`,
  `DROP TRIGGER IF EXISTS message_ad`,
  `DROP TRIGGER IF EXISTS message_au`,

  // Trigger: assign fts_rowid, populate searchable_text, and sync FTS on INSERT.
  // fts_rowid is assigned here (not by app code) so every insert path is covered and no caller can
  // forget it; MAX+1 is race-free under withWriteTx serialization and O(log N) via the
  // message_fts_rowid_uniq index. COALESCE wraps group_concat because it returns NULL when no text
  // parts match (e.g. tool-only or empty messages).
  `CREATE TRIGGER message_ai AFTER INSERT ON message BEGIN
    UPDATE message SET
      fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM message),
      searchable_text = ${searchableTextExpression('NEW.data')}
    WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM message WHERE id = NEW.id;
  END`,

  // Trigger: sync FTS on DELETE
  `CREATE TRIGGER message_ad AFTER DELETE ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
  END`,

  // Trigger: update searchable_text and sync FTS on UPDATE OF data. fts_rowid is stable across
  // data edits, so it is not reassigned here — only re-keyed delete + re-insert by fts_rowid.
  // COALESCE: see message_ai above for rationale.
  `CREATE TRIGGER message_au AFTER UPDATE OF data ON message BEGIN
    INSERT INTO message_fts(message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
    UPDATE message SET searchable_text = ${searchableTextExpression('NEW.data')} WHERE id = NEW.id;
    INSERT INTO message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM message WHERE id = NEW.id;
  END`
]

/** Examples */

/**
 * SQL expression to extract searchable text from data.parts.
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
// JOIN message_fts fts ON m.fts_rowid = fts.rowid
// WHERE message_fts MATCH ?
// ORDER BY rank
// `
