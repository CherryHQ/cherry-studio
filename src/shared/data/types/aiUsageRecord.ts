/**
 * Best-effort AI usage record entity types
 *
 * Records contain per-request usage and cost attributed to a provider/model
 * and, when captured, a credential identity. They are immutable analytical
 * snapshots, not financially reconcilable billing events. DTO/query/API
 * schemas live in `@shared/data/api/schemas/aiUsageRecords`.
 */

import * as z from 'zod'

import { CURRENCY, objectValues } from './model'

const FiniteNonnegativeNumberSchema = z.number().nonnegative().refine(Number.isFinite)
const FiniteNonnegativeIntegerSchema = z.number().int().nonnegative().refine(Number.isSafeInteger)

export const AiUsageRecordKindSchema = z.enum(['invocation', 'legacy-aggregate'])
export type AiUsageRecordKind = z.infer<typeof AiUsageRecordKindSchema>

export const AiUsageRecordMessageKindSchema = z.enum(['chat', 'agent-session'])
export type AiUsageRecordMessageKind = z.infer<typeof AiUsageRecordMessageKindSchema>

export const AiUsageRecordCostSourceSchema = z.enum(['provider', 'computed'])
export type AiUsageRecordCostSource = z.infer<typeof AiUsageRecordCostSourceSchema>

export const AiUsageCostBreakdownSchema = z.strictObject({
  input: FiniteNonnegativeNumberSchema.optional(),
  output: FiniteNonnegativeNumberSchema.optional(),
  cacheRead: FiniteNonnegativeNumberSchema.optional(),
  cacheWrite: FiniteNonnegativeNumberSchema.optional(),
  image: FiniteNonnegativeNumberSchema.optional()
})
export type AiUsageCostBreakdown = z.infer<typeof AiUsageCostBreakdownSchema>

/**
 * Flattened threshold entry. A request whose all-in input token count exceeds
 * `aboveInputTokens` bills every bucket at these rates instead of the
 * snapshot's base rates.
 */
const AiUsagePricingThresholdSchema = z.strictObject({
  aboveInputTokens: FiniteNonnegativeIntegerSchema,
  inputPerMillionTokens: FiniteNonnegativeNumberSchema,
  outputPerMillionTokens: FiniteNonnegativeNumberSchema,
  cacheReadPerMillionTokens: FiniteNonnegativeNumberSchema.optional(),
  cacheWritePerMillionTokens: FiniteNonnegativeNumberSchema.optional()
})

export const AiUsagePricingSnapshotSchema = z.strictObject({
  currency: z.enum(objectValues(CURRENCY)),
  inputPerMillionTokens: FiniteNonnegativeNumberSchema.optional(),
  outputPerMillionTokens: FiniteNonnegativeNumberSchema.optional(),
  cacheReadPerMillionTokens: FiniteNonnegativeNumberSchema.optional(),
  cacheWritePerMillionTokens: FiniteNonnegativeNumberSchema.optional(),
  perImage: z
    .strictObject({
      price: FiniteNonnegativeNumberSchema,
      unit: z.enum(['image', 'pixel'])
    })
    .optional(),
  thresholds: z.array(AiUsagePricingThresholdSchema).optional(),
  capturedAt: z.iso.datetime()
})
export type AiUsagePricingSnapshot = z.infer<typeof AiUsagePricingSnapshotSchema>

/**
 * How the serving credential was attributed at write time:
 * - `explicit`: configured key captured by the serving-key selection owner.
 * - `matched`: caller override matched to a configured key.
 * - `auth`: provider authenticates with a provider-level credential
 *   (IAM/OAuth/external CLI), not an API key.
 * - `unknown`: the serving credential cannot be safely identified.
 */
export const AiUsageRecordAttributionSchema = z.enum(['explicit', 'matched', 'auth', 'unknown'])
export type AiUsageRecordAttribution = z.infer<typeof AiUsageRecordAttributionSchema>

/** Non-secret provider-level authentication mechanism used for `auth` attribution. */
export const AiUsageRecordAuthMethodSchema = z.enum([
  'oauth',
  'external-cli',
  'iam-aws',
  'api-key-aws',
  'iam-gcp',
  'iam-azure'
])
export type AiUsageRecordAuthMethod = z.infer<typeof AiUsageRecordAuthMethodSchema>

/**
 * What kind of provider request the record describes:
 * - `language`: chat / gateway / one-shot text (token-priced, full breakdown)
 * - `embedding`: embedding calls (token-priced, input only)
 * - `image`: image generation (priced per image via `pricing.perImage`)
 */
export const AiUsageRecordModalitySchema = z.enum(['language', 'embedding', 'image', 'rerank'])
export type AiUsageRecordModality = z.infer<typeof AiUsageRecordModalitySchema>

/**
 * User-facing source that produced the usage:
 * - `assistant`: regular chat topic owned by an assistant
 * - `agent`: agent session message
 */
export const AiUsageRecordSourceTypeSchema = z.enum(['assistant', 'agent'])
export type AiUsageRecordSourceType = z.infer<typeof AiUsageRecordSourceTypeSchema>

export const AiUsageRecordEntrySchema = z.strictObject({
  /** UUIDv7 (time-ordered), auto-generated */
  id: z.uuidv7(),
  /** Stable per-request idempotency key (plain snapshot, NOT a FK) */
  requestId: z.string(),
  recordKind: AiUsageRecordKindSchema,
  requestCount: z.number().int().positive(),
  messageKind: AiUsageRecordMessageKindSchema.nullable(),
  messageId: z.string().nullable(),
  /** Provider id snapshot. Legacy aggregates may be unknown. */
  providerId: z.string().nullable(),
  /** Provider display name at write time */
  providerName: z.string().nullable(),
  sourceType: AiUsageRecordSourceTypeSchema.nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceIcon: z.string().nullable(),
  /** Provider-native model id snapshot. Legacy aggregates may be unknown. */
  modelId: z.string().nullable(),
  modelName: z.string().nullable(),
  modality: AiUsageRecordModalitySchema,

  /** API key id snapshot (null when attribution is auth/unknown) */
  apiKeyId: z.string().nullable(),
  /** Key label at write time */
  apiKeyLabel: z.string().nullable(),
  /** Masked key value at write time (never the raw key) */
  apiKeyMasked: z.string().nullable(),
  apiKeyAttribution: AiUsageRecordAttributionSchema,
  /** Provider-level auth mechanism; populated only for `auth` attribution. */
  authMethod: AiUsageRecordAuthMethodSchema.nullable(),

  // Token usage (AI SDK v6 names, mirrors MessageStats)
  inputTokens: FiniteNonnegativeIntegerSchema.nullable(),
  outputTokens: FiniteNonnegativeIntegerSchema.nullable(),
  totalTokens: FiniteNonnegativeIntegerSchema.nullable(),
  reasoningTokens: FiniteNonnegativeIntegerSchema.nullable(),
  noCacheTokens: FiniteNonnegativeIntegerSchema.nullable(),
  cacheReadTokens: FiniteNonnegativeIntegerSchema.nullable(),
  cacheWriteTokens: FiniteNonnegativeIntegerSchema.nullable(),
  /** Generated image count (modality `image`) */
  imageCount: FiniteNonnegativeIntegerSchema.nullable(),

  // Cost and immutable pricing snapshot belong to the invocation fact.
  cost: FiniteNonnegativeNumberSchema.nullable(),
  costCurrency: z.enum(objectValues(CURRENCY)).nullable(),
  costSource: AiUsageRecordCostSourceSchema.nullable(),
  costBreakdown: AiUsageCostBreakdownSchema.nullable(),
  pricingSnapshot: AiUsagePricingSnapshotSchema.nullable(),
  timeFirstTokenMs: FiniteNonnegativeIntegerSchema.nullable(),
  timeCompletionMs: FiniteNonnegativeIntegerSchema.nullable(),
  timeThinkingMs: FiniteNonnegativeIntegerSchema.nullable(),

  /** ISO 8601 datetime */
  createdAt: z.iso.datetime()
})
/** Best-effort AI usage record entity. */
export type AiUsageRecordEntry = z.infer<typeof AiUsageRecordEntrySchema>

type AiUsageRecordTokenFields = Pick<AiUsageRecordEntry, 'inputTokens' | 'outputTokens' | 'totalTokens'>

/** Returns the record's effective total without treating wholly unknown usage as zero. */
export function getAiUsageRecordTotalTokens(record: AiUsageRecordTokenFields): number | null {
  if (record.totalTokens !== null) return record.totalTokens
  if (record.inputTokens === null && record.outputTokens === null) return null
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
}
