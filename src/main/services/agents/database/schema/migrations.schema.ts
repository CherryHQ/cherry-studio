/**
 * Transitional agents service-local migration tracking schema.
 *
 * This directory is being phased out in v2. Canonical shared DB schemas now
 * live under `src/main/data/db/schemas`, but this file remains temporarily until
 * the legacy agents service layer is fully migrated to the v2 data API.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const migrations = sqliteTable('migrations', {
  version: integer('version').primaryKey(),
  tag: text('tag').notNull(),
  executedAt: integer('executed_at').notNull()
})

export type Migration = typeof migrations.$inferSelect
export type NewMigration = typeof migrations.$inferInsert
