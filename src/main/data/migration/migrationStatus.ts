import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { appStateTable } from '@data/db/schemas/appState'
import type { DbType } from '@data/db/types'

export const MIGRATION_V2_STATUS = 'migration_v2_status'

export const migrationStatusSchema = z.object({
  status: z.enum(['completed', 'failed', 'in_progress']),
  migratedFromV1: z.boolean().optional(),
  completedAt: z.number().optional()
})

export function readMigrationV2Status(db: DbType) {
  const row = db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()
  return row ? migrationStatusSchema.parse(row.value) : undefined
}

export function readMigrationV2CompletedAt(db: DbType): number | undefined {
  const status = readMigrationV2Status(db)
  return status?.status === 'completed' ? status.completedAt : undefined
}
