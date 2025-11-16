import type { LibSQLDatabase } from 'drizzle-orm/libsql'

export type DbType = LibSQLDatabase

export interface ISeed {
  migrate(db: DbType): Promise<void>
}
