/**
 * Migration tracking schema
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const migrations = sqliteTable('migrations', {
  version: integer('version').primaryKey(),
  tag: text('tag').notNull(),
  executedAt: integer('executed_at').notNull()
})

export type Migration = typeof migrations.$inferSelect
export type NewMigration = typeof migrations.$inferInsert
