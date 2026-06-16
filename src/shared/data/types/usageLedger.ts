/**
 * Usage ledger entity types
 *
 * The ledger is the durable per-message billing record: token usage + cost,
 * attributed to a provider/model and (best-effort) an API key. Rows are
 * snapshots — they survive deletion of the message, topic, provider, and key
 * they describe. DTO/Query/API schemas live in `@shared/data/api/schemas/usageLedger`.
 */

import * as z from 'zod'

import { MessageStatsSchema } from './message'

/**
 * How the API key was attributed at write time:
 * - `exact`: provider had exactly one enabled key — deterministic.
 * - `rotation`: resolved from the round-robin rotation pointer — best-effort
 *   (concurrent requests to the same multi-key provider may move the pointer).
 * - `backfill`: historical migration fallback using the provider's first
 *   configured API key because the serving key was not recorded.
 * - `auth`: provider authenticates with a provider-level credential
 *   (IAM/OAuth), not an API key.
 * - `none`: unresolvable (no enabled keys, pointer lost on restart, key deleted).
 */
export const UsageLedgerAttributionSchema = z.enum(['exact', 'rotation', 'backfill', 'auth', 'none'])
export type UsageLedgerAttribution = z.infer<typeof UsageLedgerAttributionSchema>

/**
 * What kind of request a ledger row bills:
 * - `language`: chat / gateway / one-shot text (token-priced, full breakdown)
 * - `embedding`: embedding calls (token-priced, input only)
 * - `image`: image generation (priced per image via `pricing.perImage`)
 */
export const UsageLedgerModalitySchema = z.enum(['language', 'embedding', 'image'])
export type UsageLedgerModality = z.infer<typeof UsageLedgerModalitySchema>

/**
 * User-facing source that produced the usage:
 * - `assistant`: regular chat topic owned by an assistant
 * - `agent`: agent session message
 */
export const UsageLedgerSourceTypeSchema = z.enum(['assistant', 'agent'])
export type UsageLedgerSourceType = z.infer<typeof UsageLedgerSourceTypeSchema>

export const UsageLedgerEntrySchema = z.strictObject({
  /** UUIDv7 (time-ordered), auto-generated */
  id: z.uuidv7(),
  /** Assistant message this row records (plain snapshot, NOT a FK) */
  messageId: z.string(),
  /** Topic snapshot (null for non-topic sources) */
  topicId: z.string().nullable(),
  /** Provider id snapshot */
  providerId: z.string(),
  /** Provider display name at write time */
  providerName: z.string().nullable(),
  sourceType: UsageLedgerSourceTypeSchema.nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceIcon: z.string().nullable(),
  /** UniqueModelId ("providerId::modelId") snapshot */
  modelId: z.string().nullable(),
  modality: UsageLedgerModalitySchema,

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
  noCacheTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  /** Generated image count (modality `image`) */
  imageCount: z.number().nullable(),

  // Cost (mirrors MessageStats cost fields)
  cost: z.number().nullable(),
  costCurrency: z.string().nullable(),
  costSource: z.enum(['provider', 'computed']).nullable(),
  costBreakdown: MessageStatsSchema.shape.costBreakdown.nullable(),
  pricingSnapshot: MessageStatsSchema.shape.pricingSnapshot.nullable(),
  timeFirstTokenMs: z.number().nullable(),
  timeCompletionMs: z.number().nullable(),
  timeThinkingMs: z.number().nullable(),

  /** ISO 8601 datetime */
  createdAt: z.iso.datetime(),
  /** ISO 8601 datetime */
  updatedAt: z.iso.datetime()
})
/** Usage ledger entry entity. */
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntrySchema>
