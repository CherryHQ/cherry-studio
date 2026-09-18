import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const remoteCommandTable = sqliteTable(
  'remote_command',
  {
    deviceId: text().notNull(),
    commandId: text().notNull(),
    requestHash: text().notNull(),
    agentId: text().notNull(),
    sessionId: text(),
    result: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer().notNull().$defaultFn(Date.now)
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.commandId] })]
)

export type RemoteCommandRow = typeof remoteCommandTable.$inferSelect
