import type { MessageData, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    // Stable integer surrogate for the FTS5 content_rowid (see message.ts for full rationale):
    // trigger-assigned, local-only, nullable because the AFTER INSERT trigger fills it.
    ftsRowid: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_message_session_created_id_idx').on(t.sessionId, t.createdAt, t.id),
    // Backs findPendingAssistantMessageIds (boot reconcile); avoids a full SCAN. Plain, not
    // partial — Drizzle binds `status = ?`, which SQLite can't match to a partial index.
    index('agent_session_message_status_idx').on(t.status),
    // FTS5 content_rowid key — UNIQUE so its index keeps the per-row MAX(fts_rowid)+1 assignment
    // O(log N) (see ftsRowid column + message.ts for the rationale).
    uniqueIndex('agent_session_message_fts_rowid_uniq').on(t.ftsRowid),
    check('agent_session_message_role_check', sql`${t.role} IN ('user', 'assistant', 'system')`),
    check('agent_session_message_status_check', sql`${t.status} IN ('pending', 'success', 'error', 'paused')`)
  ]
)

export type AgentSessionMessageRow = typeof agentSessionMessageTable.$inferSelect
export type InsertAgentSessionMessageRow = typeof agentSessionMessageTable.$inferInsert

/**
 * FTS5 SQL statements for agent session message full-text search.
 *
 * Drizzle does not manage virtual tables or triggers, so these are executed through DbService
 * custom SQL after migrations. The FTS index is keyed on the stable `fts_rowid` column (NOT the
 * implicit rowid, which a table rebuild or VACUUM would reshuffle — see schemas/message.ts). The
 * triggers assign `fts_rowid`, keep `searchable_text` in sync with text-bearing message parts, and
 * mirror it into the FTS index.
 */
export const AGENT_SESSION_MESSAGE_FTS_STATEMENTS: string[] = [
  // Keyed on the stable `fts_rowid` column, not the implicit rowid (which a table rebuild or
  // VACUUM would reshuffle, silently desyncing this external-content index). See message.ts.
  `CREATE VIRTUAL TABLE IF NOT EXISTS agent_session_message_fts USING fts5(
    searchable_text,
    content='agent_session_message',
    content_rowid='fts_rowid',
    tokenize='trigram'
  )`,

  // DROP+CREATE so body / fts_rowid-wiring changes take effect on existing DBs.
  `DROP TRIGGER IF EXISTS agent_session_message_ai`,
  `DROP TRIGGER IF EXISTS agent_session_message_ad`,
  `DROP TRIGGER IF EXISTS agent_session_message_au`,

  `CREATE TRIGGER agent_session_message_ai AFTER INSERT ON agent_session_message BEGIN
    UPDATE agent_session_message SET
      fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM agent_session_message),
      searchable_text = COALESCE((
        SELECT group_concat(json_extract(value, '$.text'), char(10))
        FROM json_each(json_extract(NEW.data, '$.parts'))
        WHERE json_extract(value, '$.type') IN ('text', 'reasoning')
      ), '')
    WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`,

  `CREATE TRIGGER agent_session_message_ad AFTER DELETE ON agent_session_message BEGIN
    INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
  END`,

  `CREATE TRIGGER agent_session_message_au AFTER UPDATE OF data ON agent_session_message BEGIN
    INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
    UPDATE agent_session_message SET searchable_text = COALESCE((
      SELECT group_concat(json_extract(value, '$.text'), char(10))
      FROM json_each(json_extract(NEW.data, '$.parts'))
      WHERE json_extract(value, '$.type') IN ('text', 'reasoning')
    ), '') WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`
]
