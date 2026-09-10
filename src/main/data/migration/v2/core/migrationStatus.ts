import { appStateTable } from '@data/db/schemas/appState'
import type { DbType } from '@data/db/types'
import type { MigrationStatusValue } from '@shared/data/migration/v2/types'
import { eq } from 'drizzle-orm'

export const MIGRATION_V2_STATUS = 'migration_v2_status'

/** Read the one-shot migration status through the migration domain's owner API. */
export function readMigrationV2Status(db: DbType): MigrationStatusValue | undefined {
  const row = db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()
  return row?.value as MigrationStatusValue | undefined
}

/** Return the completion boundary only for a successfully completed migration. */
export function readMigrationV2CompletedAt(db: DbType): number | undefined {
  const status = readMigrationV2Status(db)
  return status?.status === 'completed' && Number.isFinite(status.completedAt) ? status.completedAt : undefined
}
