/**
 * Best-effort AI usage record entity types
 *
 * Records contain per-request usage and cost attributed to a provider/model
 * and, when captured, a credential identity. They are analytical snapshots,
 * not immutable or financially reconcilable billing events. DTO/query/API
 * schemas live in `@shared/data/api/schemas/aiUsageRecord`.
 */

import * as z from 'zod'

import { CostSourceSchema, MessageStatsSchema } from './message'
import { CURRENCY, objectValues } from './model'

/**
 * How the serving credential was attributed at write time:
 * - `explicit`: configured key captured by the serving-key selection owner.
 * - `matched`: caller override matched to a configured key.
 * - `fallback`: compatibility inference from current provider state.
 * - `auth`: provider authenticates with a provider-level credential
 *   (IAM/OAuth/external CLI), not an API key.
 * - `unknown`: the serving credential cannot be safely identified.
 */
export const AiUsageRecordAttributionSchema = z.enum(['explicit', 'matched', 'fallback', 'auth', 'unknown'])
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
export const AiUsageRecordModalitySchema = z.enum(['language', 'embedding', 'image'])
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
  /** Topic snapshot (null for non-topic sources) */
  topicId: z.string().nullable(),
  /** Provider id snapshot */
  providerId: z.string(),
  /** Provider display name at write time */
  providerName: z.string().nullable(),
  sourceType: AiUsageRecordSourceTypeSchema.nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceIcon: z.string().nullable(),
  /** UniqueModelId ("providerId::modelId") snapshot */
  modelId: z.string(),
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
  costCurrency: z.enum(objectValues(CURRENCY)).nullable(),
  costSource: CostSourceSchema.nullable(),
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
/** Best-effort AI usage record entity. */
export type AiUsageRecordEntry = z.infer<typeof AiUsageRecordEntrySchema>
