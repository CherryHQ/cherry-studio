/**
 * Usage ledger entity types
 *
 * The ledger is the durable per-message billing record: token usage + cost,
 * attributed to a provider/model and (best-effort) an API key. Rows are
 * snapshots — they survive deletion of the message, topic, provider, and key
 * they describe. DTO/Query/API schemas live in `@shared/data/api/schemas/usageLedger`.
 */

import * as z from 'zod'

/**
 * How the API key was attributed at write time:
 * - `exact`: provider had exactly one enabled key — deterministic.
 * - `rotation`: resolved from the round-robin rotation pointer — best-effort
 *   (concurrent requests to the same multi-key provider may move the pointer).
 * - `backfill`: written by reconciliation (v1-migrated history, recovered
 *   lost writes) for a provider with exactly one configured key — a guess,
 *   the serving key is not recorded anywhere.
 * - `auth`: provider authenticates with a provider-level credential
 *   (IAM/OAuth), not an API key.
 * - `none`: unresolvable (no enabled keys, pointer lost on restart, key deleted).
 */
export const UsageLedgerAttributionSchema = z.enum(['exact', 'rotation', 'backfill', 'auth', 'none'])
export type UsageLedgerAttribution = z.infer<typeof UsageLedgerAttributionSchema>

export const UsageLedgerEntrySchema = z.strictObject({
  /** UUIDv7 (time-ordered), auto-generated */
  id: z.uuidv7(),
  /** Assistant message this row records (plain snapshot, NOT a FK) */
  messageId: z.string(),
  /** Topic snapshot (null for non-topic sources) */
  topicId: z.string().nullable(),
  /** Provider id snapshot */
  providerId: z.string(),
  /** UniqueModelId ("providerId::modelId") snapshot */
  modelId: z.string().nullable(),

  /** API key id snapshot (null when attribution is auth/none) */
  apiKeyId: z.string().nullable(),
  /** Key label at write time */
  apiKeyLabel: z.string().nullable(),
  /** Masked key value at write time (never the raw key) */
  apiKeyMasked: z.string().nullable(),
  apiKeyAttribution: UsageLedgerAttributionSchema,

  // Token usage (AI SDK v6 names, mirrors MessageStats)
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),

  // Cost (mirrors MessageStats cost fields)
  cost: z.number().nullable(),
  costCurrency: z.string().nullable(),
  costSource: z.enum(['provider', 'computed']).nullable(),

  /** ISO 8601 datetime */
  createdAt: z.iso.datetime(),
  /** ISO 8601 datetime */
  updatedAt: z.iso.datetime()
})
/** Usage ledger entry entity. */
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntrySchema>
