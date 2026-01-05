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
 * SQL expression to extract searchable text from data.blocks
 * Concatenates content from all main_text type blocks
 */
export const SEARCHABLE_TEXT_EXPRESSION = `
  (SELECT group_concat(json_extract(value, '$.content'), ' ')
   FROM json_each(json_extract(NEW.data, '$.blocks'))
   WHERE json_extract(value, '$.type') = 'main_text')
`

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

/**
 * Rebuild FTS index (run manually if needed)
 */
export const REBUILD_FTS_SQL = `INSERT INTO message_fts(message_fts) VALUES ('rebuild')`

/**
 * Example search query
 */
export const EXAMPLE_SEARCH_SQL = `
SELECT m.*
FROM message m
JOIN message_fts fts ON m.rowid = fts.rowid
WHERE message_fts MATCH ?
ORDER BY rank
`
