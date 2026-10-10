import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export type DbType = BetterSQLite3Database

/** Structural alias accepted by both BetterSQLite3Database and its synchronous transaction handle. */
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
  /** Execute the seed operation (called within a synchronous transaction by SeedRunner) */
  run(db: DbType): void
}
