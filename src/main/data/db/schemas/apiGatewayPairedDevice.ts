import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/** Devices approved through remote-access pairing, keyed by their proven identity. */
export const apiGatewayPairedDeviceTable = sqliteTable(
  'api_gateway_paired_device',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    platform: text().notNull(),
    // Pre-Noise device rows survive migration without an identity or remote grants.
    peerIdentity: text(),
    configurationGrantId: text(),
    agentGrantId: text(),
    ...createUpdateTimestamps
  },
  (t) => [uniqueIndex('api_gateway_paired_device_peer_identity_unique_idx').on(t.peerIdentity)]
)

export type ApiGatewayPairedDeviceRow = typeof apiGatewayPairedDeviceTable.$inferSelect
export type InsertApiGatewayPairedDeviceRow = typeof apiGatewayPairedDeviceTable.$inferInsert
