/**
 * Database Module
 *
 * This module provides centralized access to all database-related functionality
 * including queries, schema definitions, migrations, and the migration runner.
 */

// Migration system
export * from './migrations'
export { Migrator } from './migrator'

// Database queries (organized by entity)
export * as AgentQueries from './queries/agent.queries'
export * as SessionQueries from './queries/session.queries'
export * as SessionLogQueries from './queries/sessionLog.queries'

// Schema definitions
export * as Schema from './schema'
export { IndexDefinitions } from './schema/indexes'
export * as MigrationsSchema from './schema/migrations'
export { TableDefinitions } from './schema/tables'

// Backward compatibility - maintain the old AgentQueries structure
export const AgentQueries_Legacy = {
  // Table creation queries
  createTables: {
    agents: undefined as any, // Will be populated from schema
    sessions: undefined as any,
    sessionLogs: undefined as any
  },

  // Index creation queries
  createIndexes: undefined as any,

  // Agent operations
  agents: undefined as any,

  // Session operations
  sessions: undefined as any,

  // Session logs operations
  sessionLogs: undefined as any
}

// Initialize legacy structure with actual imports
import * as AgentQueriesActual from './queries/agent.queries'
import * as SessionQueriesActual from './queries/session.queries'
import * as SessionLogQueriesActual from './queries/sessionLog.queries'
import { IndexDefinitions } from './schema/indexes'
import { TableDefinitions } from './schema/tables'

AgentQueries_Legacy.createTables.agents = TableDefinitions.agents
AgentQueries_Legacy.createTables.sessions = TableDefinitions.sessions
AgentQueries_Legacy.createTables.sessionLogs = TableDefinitions.sessionLogs
AgentQueries_Legacy.createIndexes = IndexDefinitions
AgentQueries_Legacy.agents = AgentQueriesActual.AgentQueries
AgentQueries_Legacy.sessions = SessionQueriesActual.SessionQueries
AgentQueries_Legacy.sessionLogs = SessionLogQueriesActual.SessionLogQueries
