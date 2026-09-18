import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { apiGatewayPairedDeviceTable } from './apiGatewayPairedDevice'

export const remoteCommandTable = sqliteTable(
  'remote_command',
  {
    // A deleted device's ID never authenticates again, so its receipts go with it.
    deviceId: text()
      .notNull()
      .references(() => apiGatewayPairedDeviceTable.id, { onDelete: 'cascade' }),
    commandId: text().notNull(),
    requestHash: text().notNull(),
    agentId: text().notNull(),
    result: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer().notNull().$defaultFn(Date.now)
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.commandId] })]
)

export type RemoteCommandRow = typeof remoteCommandTable.$inferSelect
