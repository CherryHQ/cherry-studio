import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export const cherryAccountSessionTable = sqliteTable('cherry_account_session', {
  id: text().primaryKey(),
  accessToken: text().notNull(),
  accessExpiresAt: integer().notNull(),
  refreshToken: text().notNull(),
  sessionId: text().notNull(),
  sessionExpiresAt: integer().notNull(),
  deviceId: text().notNull(),
  accountId: text().notNull(),
  displayName: text(),
  devicePublicKey: text().notNull(),
  devicePrivateKey: text().notNull(),
  ...createUpdateTimestamps
})

export type CherryAccountSessionRow = typeof cherryAccountSessionTable.$inferSelect
