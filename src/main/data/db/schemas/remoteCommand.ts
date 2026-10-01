import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { RemoteFailure } from '@cherrystudio/remote-protocol'

import { createUpdateTimestamps } from './_columnHelpers'
import { apiGatewayPairedDeviceTable } from './apiGatewayPairedDevice'

/** Durable receipts for remote Agent commands, keyed by device + authorization generation + command. */
export const remoteCommandTable = sqliteTable(
  'remote_command',
  {
    deviceId: text()
      .notNull()
      .references(() => apiGatewayPairedDeviceTable.id, { onDelete: 'cascade' }),
    grantId: text().notNull(),
    commandId: text().notNull(),
    method: text().notNull(),
    identityDigest: text().notNull(),
    status: text().$type<'accepted' | 'applied' | 'rejected' | 'interrupted'>().notNull(),
    sessionId: text(),
    executionId: text(),
    result: text({ mode: 'json' }).$type<unknown>(),
    error: text({ mode: 'json' }).$type<RemoteFailure>(),
    admittedAt: integer().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.grantId, t.commandId] })]
)

export type RemoteCommandRow = typeof remoteCommandTable.$inferSelect
