import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/** Devices authorized through the API Gateway's one-time LAN pairing flow. */
export const apiGatewayPairedDeviceTable = sqliteTable(
  'api_gateway_paired_device',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    platform: text().notNull(),
    tokenHash: text(),
    peerIdentity: text(),
    configurationGrantId: text(),
    agentGrantId: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('api_gateway_paired_device_token_hash_unique_idx').on(t.tokenHash),
    uniqueIndex('api_gateway_paired_device_peer_identity_unique_idx').on(t.peerIdentity)
  ]
)

export type ApiGatewayPairedDeviceRow = typeof apiGatewayPairedDeviceTable.$inferSelect
export type InsertApiGatewayPairedDeviceRow = typeof apiGatewayPairedDeviceTable.$inferInsert
