/**
 * Custom SQL statements that Drizzle cannot manage
 *
 * Drizzle ORM doesn't track:
 * - Virtual tables (FTS5)
 * - Triggers
 * - Custom indexes with expressions
 *
 * These are executed after every migration via DbService.runCustomMigrations()
 * All statements must be idempotent (use IF NOT EXISTS, etc.)
 *
 * To add new custom SQL:
 * 1. Create statements in the relevant schema file (e.g., messageFts.ts)
 * 2. Import and spread them into CUSTOM_SQL_STATEMENTS below
 */

import {
  AGENT_SESSION_MESSAGE_FTS_BACKFILL_STATEMENTS,
  AGENT_SESSION_MESSAGE_FTS_STATEMENTS
} from './schemas/agentSessionMessage'
import { MESSAGE_FTS_BACKFILL_STATEMENTS, MESSAGE_FTS_STATEMENTS } from './schemas/message'

/**
 * Idempotent custom SQL re-run after every migration (CREATE ... IF NOT EXISTS,
 * DROP/CREATE TRIGGER). Cheap and safe to replay on every boot.
 */
export const CUSTOM_SQL_STATEMENTS: string[] = [
  ...MESSAGE_FTS_STATEMENTS,
  ...AGENT_SESSION_MESSAGE_FTS_STATEMENTS
  // Add more idempotent custom SQL arrays here as needed
]

/**
 * One-shot custom SQL (expensive backfills / FTS rebuilds, O(all rows)). Each
 * group runs exactly once, guarded by its `key` in the `custom_sql_state` marker
 * table — see DbService.runCustomMigrations. Bump a key (e.g. `_v2`) to force its
 * statements to re-run once after the underlying searchable-text expression changes.
 */
export const CUSTOM_SQL_ONCE_STATEMENTS: ReadonlyArray<{ key: string; statements: string[] }> = [
  { key: 'message_fts_backfill_v1', statements: MESSAGE_FTS_BACKFILL_STATEMENTS },
  { key: 'agent_session_message_fts_backfill_v1', statements: AGENT_SESSION_MESSAGE_FTS_BACKFILL_STATEMENTS }
]
