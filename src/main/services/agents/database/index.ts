/**
 * Database Module
 *
 * This module provides centralized access to Drizzle ORM schemas and
 * repository helpers for the agents service. Tables live on the main
 * SQLite database and are migrated by the v2 migration engine; there is
 * no longer a per-service DatabaseManager.
 */

export * from './schema'
export * from './sessionMessageRepository'
