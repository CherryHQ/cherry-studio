/**
 * Database schema for migration tracking table
 */

/**
 * SQL to create the migrations tracking table
 * This table keeps track of which migrations have been applied
 */
export const createMigrationsTable = `
  CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    execution_time INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`

/**
 * SQL to create indexes for the migrations table
 */
export const createMigrationsIndexes = [
  'CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON migrations(applied_at)',
  'CREATE INDEX IF NOT EXISTS idx_migrations_checksum ON migrations(checksum)'
]

/**
 * SQL to drop the migrations table (for cleanup if needed)
 */
export const dropMigrationsTable = 'DROP TABLE IF EXISTS migrations'

/**
 * SQL to check if migrations table exists
 */
export const checkMigrationsTableExists = `
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name='migrations'
`

/**
 * SQL to get all applied migrations ordered by ID
 */
export const getAppliedMigrations = `
  SELECT id, description, applied_at, execution_time, checksum
  FROM migrations
  ORDER BY id ASC
`

/**
 * SQL to check if a specific migration has been applied
 */
export const isMigrationApplied = `
  SELECT id FROM migrations WHERE id = ? LIMIT 1
`

/**
 * SQL to record a migration as applied
 */
export const recordMigrationApplied = `
  INSERT INTO migrations (id, description, applied_at, execution_time, checksum)
  VALUES (?, ?, ?, ?, ?)
`

/**
 * SQL to remove a migration record (for rollback)
 */
export const removeMigrationRecord = `
  DELETE FROM migrations WHERE id = ?
`

/**
 * SQL to get the latest applied migration
 */
export const getLatestMigration = `
  SELECT id, description, applied_at, execution_time, checksum
  FROM migrations
  ORDER BY id DESC
  LIMIT 1
`

/**
 * SQL to count applied migrations
 */
export const countAppliedMigrations = `
  SELECT COUNT(*) as count FROM migrations
`
