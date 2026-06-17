/**
 * Custom SQL statements that Drizzle cannot manage
 *
 * Drizzle ORM doesn't track:
 * - Virtual tables (FTS5)
 * - Triggers
 * - Custom indexes with expressions
 *
 * These are executed after every migration via DbService.runCustomMigrations() (i.e. every boot).
 * All statements must be idempotent: virtual tables use CREATE ... IF NOT EXISTS; triggers use
 * DROP TRIGGER IF EXISTS + CREATE (so an edited trigger body takes effect on existing DBs).
 *
 * See docs/references/data/database-construction.md for the full rationale (~0.1ms O(1) cost,
 * the cheap/expensive buckets, and the FTS5 fts_rowid rule).
 *
 * To add new custom SQL:
 * 1. Create statements in the relevant schema file (e.g., schemas/message.ts)
 * 2. Import and spread them into CUSTOM_SQL_STATEMENTS below
 */

import { AGENT_SESSION_MESSAGE_FTS_STATEMENTS } from './schemas/agentSessionMessage'
import { MESSAGE_FTS_STATEMENTS } from './schemas/message'

/**
 * All custom SQL statements to run after migrations
 */
export const CUSTOM_SQL_STATEMENTS: string[] = [
  ...MESSAGE_FTS_STATEMENTS,
  ...AGENT_SESSION_MESSAGE_FTS_STATEMENTS
  // Add more custom SQL arrays here as needed
]
