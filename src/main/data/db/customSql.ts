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

import { MESSAGE_FTS_STATEMENTS } from './schemas/messageFts'

/**
 * All custom SQL statements to run after migrations
 */
export const CUSTOM_SQL_STATEMENTS: string[] = [
  ...MESSAGE_FTS_STATEMENTS
  // Add more custom SQL arrays here as needed
]
