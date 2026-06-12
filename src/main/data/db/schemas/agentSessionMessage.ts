import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { agentSessionTable } from './agentSession'
import { userModelTable } from './userModel'

export const agentSessionMessageTable = sqliteTable(
  'agent_session_message',
  {
    id: uuidPrimaryKeyOrdered(),
    sessionId: text()
      .notNull()
      .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    // `data` stores MessageData (`{ parts }`); Drizzle handles
    // JSON.stringify/parse automatically via `{ mode: 'json' }`.
    data: text({ mode: 'json' }).$type<MessageData>().notNull(),
    searchableText: text().notNull().default(''),
    status: text().notNull(),
    modelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    modelSnapshot: text({ mode: 'json' }).$type<ModelSnapshot>(),
    stats: text({ mode: 'json' }).$type<MessageStats>(),
    runtimeResumeToken: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_message_session_created_id_idx').on(t.sessionId, t.createdAt, t.id),
    // Backs findPendingAssistantMessageIds (boot reconcile); avoids a full SCAN. Plain, not
    // partial — Drizzle binds `status = ?`, which SQLite can't match to a partial index.
    index('agent_session_message_status_idx').on(t.status),
    check('agent_session_message_role_check', sql`${t.role} IN ('user', 'assistant', 'system')`),
    check('agent_session_message_status_check', sql`${t.status} IN ('pending', 'success', 'error', 'paused')`)
  ]
)

export type AgentSessionMessageRow = typeof agentSessionMessageTable.$inferSelect
export type InsertAgentSessionMessageRow = typeof agentSessionMessageTable.$inferInsert

/**
 * FTS5 SQL statements for agent session message full-text search.
 *
 * Drizzle does not manage virtual tables or triggers, so these are executed
 * through DbService custom SQL after migrations. The triggers keep
 * `searchable_text` in sync with text-bearing message parts and mirror it into
 * the FTS index.
 */
export const AGENT_SESSION_MESSAGE_FTS_STATEMENTS: string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS agent_session_message_fts USING fts5(
    searchable_text,
    content='agent_session_message',
    content_rowid='rowid',
    tokenize='trigram'
  )`,

  `CREATE TRIGGER IF NOT EXISTS agent_session_message_ai AFTER INSERT ON agent_session_message BEGIN
    UPDATE agent_session_message SET searchable_text = COALESCE((
      SELECT group_concat(json_extract(value, '$.text'), char(10))
      FROM json_each(json_extract(NEW.data, '$.parts'))
      WHERE json_extract(value, '$.type') IN ('text', 'reasoning')
    ), '') WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`,

  `CREATE TRIGGER IF NOT EXISTS agent_session_message_ad AFTER DELETE ON agent_session_message BEGIN
    INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
  END`,

  `CREATE TRIGGER IF NOT EXISTS agent_session_message_au AFTER UPDATE OF data ON agent_session_message BEGIN
    INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.rowid, OLD.searchable_text);
    UPDATE agent_session_message SET searchable_text = COALESCE((
      SELECT group_concat(json_extract(value, '$.text'), char(10))
      FROM json_each(json_extract(NEW.data, '$.parts'))
      WHERE json_extract(value, '$.type') IN ('text', 'reasoning')
    ), '') WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`,

  `UPDATE agent_session_message SET searchable_text = COALESCE((
    SELECT group_concat(json_extract(value, '$.text'), char(10))
    FROM json_each(json_extract(agent_session_message.data, '$.parts'))
    WHERE json_extract(value, '$.type') IN ('text', 'reasoning')
  ), '')`,

  `INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT m.rowid, m.searchable_text
    FROM agent_session_message m
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_session_message_fts fts WHERE fts.rowid = m.rowid
    )`
]
