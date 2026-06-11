import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Usage ledger - append-only record of per-message token usage and cost.
 *
 * The ledger is the durable billing record: it must survive deletion of the
 * message, topic, provider, model, and API key it describes. Therefore it has
 * NO foreign keys — all references are plain string snapshots taken at write
 * time, and provider/key identity is denormalized (label, masked key) so rows
 * stay readable after the referenced key is deleted.
 *
 * Rows are written by `UsageLedgerService.recordFromMessage`, fired from the
 * data layer (`MessageService.update` and `TemporaryChatService.persist`)
 * when an assistant message lands token stats — the AI streaming pipeline is
 * not involved. One row per assistant message (`messageId` unique);
 * re-persists upsert with last-write-wins usage/cost and earliest-wins key
 * attribution (see `UsageLedgerService.recordFromMessage`).
 */
export const usageLedgerTable = sqliteTable(
  'usage_ledger',
  {
    id: uuidPrimaryKeyOrdered(),
    // Idempotency key: one ledger row per assistant message. Plain string, no FK.
    messageId: text().notNull(),
    topicId: text(),
    providerId: text().notNull(),
    // UniqueModelId ("providerId::modelId") snapshot
    modelId: text(),
    // What kind of request this row bills: language (chat/gateway/one-shot
    // text), embedding (token-priced, input only), image (per-image priced).
    modality: text().notNull().default('language'),

    // API key attribution snapshot (denormalized — key may be deleted later)
    apiKeyId: text(),
    apiKeyLabel: text(),
    apiKeyMasked: text(),
    // How the key was attributed: exact (single enabled key), rotation
    // (best-effort via the round-robin pointer), backfill (reconciliation
    // guess — provider had exactly one configured key), auth (provider-level
    // credential, e.g. IAM), none (unresolvable).
    apiKeyAttribution: text().notNull().default('none'),

    // Token usage (AI SDK v6 names, mirrors MessageStats)
    inputTokens: integer(),
    outputTokens: integer(),
    totalTokens: integer(),
    reasoningTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    // Image-generation usage (modality 'image'): number of generated images
    imageCount: integer(),

    // Cost (mirrors MessageStats cost fields)
    cost: real(),
    costCurrency: text(),
    costSource: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('usage_ledger_message_id_idx').on(t.messageId),
    index('usage_ledger_provider_created_idx').on(t.providerId, t.createdAt),
    index('usage_ledger_api_key_created_idx').on(t.apiKeyId, t.createdAt),
    index('usage_ledger_created_at_idx').on(t.createdAt),
    check(
      'usage_ledger_attribution_check',
      sql`${t.apiKeyAttribution} IN ('exact', 'rotation', 'backfill', 'auth', 'none')`
    ),
    // NULL passes a CHECK in SQLite, so nullable columns need no IS NULL branch.
    check('usage_ledger_cost_source_check', sql`${t.costSource} IN ('provider', 'computed')`),
    check('usage_ledger_modality_check', sql`${t.modality} IN ('language', 'embedding', 'image')`)
  ]
)

export type UsageLedgerRow = typeof usageLedgerTable.$inferSelect
export type InsertUsageLedgerRow = typeof usageLedgerTable.$inferInsert
