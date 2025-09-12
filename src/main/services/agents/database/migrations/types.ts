/**
 * Migration system types and interfaces for agents database
 */

/**
 * Represents a single database migration
 */
export interface Migration {
  /** Unique identifier for the migration (e.g., "001", "002") */
  id: string
  /** Human-readable description of the migration */
  description: string
  /** SQL statements to apply the migration */
  up: string[]
  /** Optional SQL statements to rollback the migration */
  down?: string[]
  /** Timestamp when migration was created */
  createdAt: Date
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  /** Migration that was executed */
  migration: Migration
  /** Whether the migration was successful */
  success: boolean
  /** Error message if migration failed */
  error?: string
  /** Timestamp when migration was executed */
  executedAt: Date
  /** Time taken to execute migration in milliseconds */
  executionTime: number
}

/**
 * Migration record stored in the migrations table
 */
export interface MigrationRecord {
  /** Migration identifier */
  id: string
  /** Migration description */
  description: string
  /** When the migration was applied */
  applied_at: string
  /** Execution time in milliseconds */
  execution_time: number
  /** Checksum of migration content for integrity */
  checksum: string
}

/**
 * Migration status for tracking
 */
export enum MigrationStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back'
}

/**
 * Migration execution options
 */
export interface MigrationOptions {
  /** Whether to run in transaction mode (default: true) */
  useTransaction?: boolean
  /** Whether to validate migration checksums (default: true) */
  validateChecksums?: boolean
  /** Maximum number of migrations to run (default: unlimited) */
  limit?: number
  /** Whether to run in dry-run mode (default: false) */
  dryRun?: boolean
}

/**
 * Migration validation result
 */
export interface ValidationResult {
  /** Whether all validations passed */
  isValid: boolean
  /** List of validation errors */
  errors: string[]
  /** List of warnings */
  warnings: string[]
}

/**
 * Migration summary information
 */
export interface MigrationSummary {
  /** Total number of migrations available */
  totalMigrations: number
  /** Number of applied migrations */
  appliedMigrations: number
  /** Number of pending migrations */
  pendingMigrations: number
  /** List of pending migration IDs */
  pendingMigrationIds: string[]
  /** Current database schema version */
  currentVersion: string
}
