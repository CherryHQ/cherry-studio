import type { LibSQLDatabase } from 'drizzle-orm/libsql'

export type DbType = LibSQLDatabase

/** Structural alias accepted by both LibSQLDatabase and LibSQLTransaction. */
export type DbOrTx = Pick<DbType, 'select' | 'update' | 'insert' | 'delete' | 'run' | 'transaction'>

/** Service-layer pagination convention used by main-side list queries. */
export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'orderKey'
  orderBy?: 'asc' | 'desc'
}

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
