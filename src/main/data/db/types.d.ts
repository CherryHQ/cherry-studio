import type { LibSQLDatabase } from 'drizzle-orm/libsql'

export type DbType = LibSQLDatabase

/** Structural alias accepted by both LibSQLDatabase and LibSQLTransaction. */
export type DbOrTx = Pick<DbType, 'select' | 'update' | 'insert' | 'delete' | 'run' | 'all' | 'transaction'>

export type SeedExecutionPolicy = 'run-on-change' | 'bootstrap-only'

export interface ISeeder {
  /** Unique identifier for seed journal tracking (stored as `seed:<name>` in app_state) */
  readonly name: string
  /** Version string for change detection — supports property or getter */
  readonly version: string
  /** Human-readable description for logging */
  readonly description: string
  /**
   * 'run-on-change' (default): re-run whenever version differs from the journal.
   * 'bootstrap-only': run only during the bootstrap window — before the first
   * fully-successful seeding pass completes on this database; never afterwards
   * (not even for seeders added in later releases).
   */
  readonly executionPolicy?: SeedExecutionPolicy
  /** Execute the seed operation (called within a transaction by SeedRunner) */
  run(db: DbType): Promise<void>
}
