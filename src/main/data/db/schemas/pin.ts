import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Pin table - polymorphic pinning across entity types
 *
 * Any entity type (topic, session, assistant, ...) can be pinned by inserting
 * a row here with (entityType, entityId). Pinning is non-destructive: the
 * referenced entity's group / order / state is unaffected. Pin order is
 * scoped per entityType via `orderKey`.
 *
 * Design notes:
 * - Polymorphic (no FK): mirrors the `entity_tag` table. Consumers MUST call
 *   `PinService.purgeForEntityTx(tx, entityType, entityId)` in their delete paths
 *   (cf. `tagService.purgeForEntityTx`) — the infra layer has zero knowledge
 *   of consumer schemas by design.
 * - Hard delete on unpin: pinning is a non-destructive marker with no business
 *   audit value. Keeping a `deletedAt` column would let dead rows accumulate
 *   for a feature that only tracks "is this currently pinned?".
 * - UNIQUE(entityType, entityId): enforces idempotency at the DB layer. The
 *   service-layer `pin()` method converts the resulting UNIQUE violation back
 *   into "return the existing row" so the DataApi boundary stays idempotent
 *   under concurrency.
 */
export const pinTable = sqliteTable(
  'pin',
  {
    id: uuidPrimaryKey(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('pin_entity_type_entity_id_unique_idx').on(t.entityType, t.entityId),
    scopedOrderKeyIndex('pin', 'entityType')(t)
  ]
)

export type PinInsert = typeof pinTable.$inferInsert
export type PinSelect = typeof pinTable.$inferSelect
