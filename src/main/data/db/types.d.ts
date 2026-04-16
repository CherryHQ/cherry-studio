import type { LibSQLDatabase } from 'drizzle-orm/libsql'

export type DbType = LibSQLDatabase

export interface ISeeder {
  /** Unique identifier for seed journal tracking (stored as `seed:<name>` in app_state) */
  readonly name: string
  /** Version string for change detection — supports property or getter */
  readonly version: string
  /** Human-readable description for logging */
  readonly description: string
  /** Execute the seed operation (called within a transaction by SeedRunner) */
  run(db: DbType): Promise<void>
}
