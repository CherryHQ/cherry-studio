/**
 * Export schema modules
 *
 * Note: We use a migration-only approach. Table and index definitions
 * are maintained in the migration files, not as separate schema files.
 * This ensures a single source of truth for the database schema.
 */

export * from './migrations'
