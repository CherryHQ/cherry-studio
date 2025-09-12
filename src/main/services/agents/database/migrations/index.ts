/**
 * Migration registry - exports all available migrations
 */

import { migration_001_initial_schema } from './001_initial_schema'
import { migration_002_add_session_tables } from './002_add_session_tables'
import type { Migration } from './types'

/**
 * All available migrations in order
 * IMPORTANT: Migrations must be exported in chronological order
 */
export const migrations: Migration[] = [migration_001_initial_schema, migration_002_add_session_tables]

/**
 * Get migration by ID
 */
export const getMigrationById = (id: string): Migration | undefined => {
  return migrations.find((migration) => migration.id === id)
}

/**
 * Get all migrations up to a specific version
 */
export const getMigrationsUpTo = (version: string): Migration[] => {
  const targetIndex = migrations.findIndex((migration) => migration.id === version)
  if (targetIndex === -1) {
    throw new Error(`Migration with ID '${version}' not found`)
  }
  return migrations.slice(0, targetIndex + 1)
}

/**
 * Get pending migrations (those that come after a specific version)
 */
export const getPendingMigrations = (currentVersion: string): Migration[] => {
  const currentIndex = migrations.findIndex((migration) => migration.id === currentVersion)
  if (currentIndex === -1) {
    // If no current version found, all migrations are pending
    return [...migrations]
  }
  return migrations.slice(currentIndex + 1)
}

/**
 * Get the latest migration ID
 */
export const getLatestMigrationId = (): string => {
  if (migrations.length === 0) {
    throw new Error('No migrations available')
  }
  return migrations[migrations.length - 1].id
}

// Re-export types for convenience
export type {
  Migration,
  MigrationOptions,
  MigrationRecord,
  MigrationResult,
  MigrationSummary,
  ValidationResult
} from './types'
export { MigrationStatus } from './types'
