/**
 * Database Module
 *
 * This module provides centralized access to all database-related functionality
 * including queries, migration system, and the migration runner.
 *
 * Note: We use a migration-only approach for database schema management.
 * Table and index definitions are maintained in the migration files rather
 * than separate schema files, ensuring a single source of truth.
 */

// Migration system
export * from './migrations'
export { Migrator } from './migrator'

// Database queries (organized by entity)
export * as AgentQueries from './queries/agent.queries'
export * as SessionQueries from './queries/session.queries'
export * as SessionMessageQueries from './queries/sessionMessage.queries'

// Migration schema utilities (for migration tracking table)
export * as MigrationsSchema from './schema/migrations'

// Backward compatibility - maintain the old AgentQueries structure
// Services only use the query methods, not the table/index creation methods
import * as AgentQueriesActual from './queries/agent.queries'
import * as SessionQueriesActual from './queries/session.queries'
import * as SessionMessageQueriesActual from './queries/sessionMessage.queries'

export const AgentQueries_Legacy = {
  // Agent operations
  agents: AgentQueriesActual.AgentQueries,

  // Session operations
  sessions: SessionQueriesActual.SessionQueries,

  // Session messages operations
  sessionMessages: SessionMessageQueriesActual.SessionMessageQueries
}
