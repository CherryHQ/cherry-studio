/**
 * Drizzle ORM schema for migrations tracking table
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const migrationsTable = sqliteTable('migrations', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  executed_at: text('executed_at').notNull(), // ISO timestamp
  execution_time: integer('execution_time') // Duration in milliseconds
})

export type MigrationRow = typeof migrationsTable.$inferSelect
export type InsertMigrationRow = typeof migrationsTable.$inferInsert
