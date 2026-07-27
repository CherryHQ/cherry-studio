import {
  type AiUsageRecordAttribution,
  AiUsageRecordAttributionSchema,
  type AiUsageRecordAuthMethod,
  AiUsageRecordAuthMethodSchema,
  type AiUsageRecordModality,
  AiUsageRecordModalitySchema,
  type AiUsageRecordSourceType,
  AiUsageRecordSourceTypeSchema
} from '@shared/data/types/aiUsageRecord'
import { type CostSource, CostSourceSchema, type MessageStats } from '@shared/data/types/message'
import { CURRENCY, type Currency, objectValues } from '@shared/data/types/model'
import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

const sqlEnumValues = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ')
const attributionCheckValues = sqlEnumValues(AiUsageRecordAttributionSchema.options)
const authMethodCheckValues = sqlEnumValues(AiUsageRecordAuthMethodSchema.options)
const costCurrencyCheckValues = sqlEnumValues(objectValues(CURRENCY))
const costSourceCheckValues = sqlEnumValues(CostSourceSchema.options)
const modalityCheckValues = sqlEnumValues(AiUsageRecordModalitySchema.options)
const sourceTypeCheckValues = sqlEnumValues(AiUsageRecordSourceTypeSchema.options)
const captureSourceCheckValues = sqlEnumValues(['runtime', 'persistence', 'migration'])

export type AiUsageRecordCaptureSource = 'runtime' | 'persistence' | 'migration'

/**
 * Durable best-effort analytical record of per-request AI usage and cost.
 *
 * It must survive deletion of the message, topic, provider, model, and API key
 * it describes. Therefore it has NO foreign keys — all references are plain
 * string snapshots taken at write time, and provider/key identity is
 * denormalized (provider name, key label, masked key) so rows stay readable
 * after the referenced provider/key is deleted.
 *
 * Rows are written by `recordRequest`/`recordFromMessage` from two converging
 * sources: a request collector in the AI pipeline (`createBillingRecorder`,
 * plus the `embedMany`/`generateImage` call sites) and post-commit data-layer
 * hooks (`MessageService.update`, `TemporaryChatService.persist`,
 * `AgentSessionMessageService.saveMessage`). One row per `requestId` (the
 * assistant message id for chat, a generated id for stateless requests);
 * re-persists converge through a guarded upsert (see
 * `AiUsageRecordService.recordRequest`).
 */
export const aiUsageRecordTable = sqliteTable(
  'ai_usage_record',
  {
    id: uuidPrimaryKeyOrdered(),
    // Idempotency key: one usage record per AI request. Plain string, no FK.
    requestId: text().notNull(),
    // Writer precedence: runtime capture owns observed request usage;
    // persistence may fill missing columns but cannot overwrite it.
    captureSource: text().$type<AiUsageRecordCaptureSource>().notNull().default('runtime'),
    topicId: text(),
    providerId: text().notNull(),
    providerName: text(),
    // Usage source snapshot: chat assistant, agent, or null for stateless calls.
    sourceType: text().$type<AiUsageRecordSourceType>(),
    sourceId: text(),
    sourceName: text(),
    sourceIcon: text(),
    // UniqueModelId ("providerId::modelId") snapshot. Every write path resolves
    // it before inserting — a request whose model cannot be identified is not
    // billable and is skipped rather than stored half-attributed.
    modelId: text().notNull(),
    // What kind of request this row bills: language (chat/gateway/one-shot
    // text), embedding (token-priced, input only), image (per-image priced).
    modality: text().$type<AiUsageRecordModality>().notNull(),

    // API key attribution snapshot (denormalized — key may be deleted later)
    apiKeyId: text(),
    apiKeyLabel: text(),
    apiKeyMasked: text(),
    // How the credential was attributed: explicit selection, matched override,
    // compatibility fallback, provider-level auth, or unknown.
    apiKeyAttribution: text().$type<AiUsageRecordAttribution>().notNull(),
    // Provider-level mechanism for `auth`; never contains a token or secret.
    authMethod: text().$type<AiUsageRecordAuthMethod>(),

    // Token usage (AI SDK v6 names, mirrors MessageStats)
    inputTokens: integer(),
    outputTokens: integer(),
    totalTokens: integer(),
    reasoningTokens: integer(),
    noCacheTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    // Image-generation usage (modality 'image'): number of generated images
    imageCount: integer(),

    // Cost (mirrors MessageStats cost fields)
    cost: real(),
    costCurrency: text().$type<Currency>(),
    costSource: text().$type<CostSource>(),
    costBreakdown: text({ mode: 'json' }).$type<NonNullable<MessageStats['costBreakdown']>>(),
    pricingSnapshot: text({ mode: 'json' }).$type<NonNullable<MessageStats['pricingSnapshot']>>(),
    // Performance metrics measured locally.
    timeFirstTokenMs: integer(),
    timeCompletionMs: integer(),
    timeThinkingMs: integer(),

    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('ai_usage_record_request_id_idx').on(t.requestId),
    index('ai_usage_record_provider_created_idx').on(t.providerId, t.createdAt),
    index('ai_usage_record_api_key_created_idx').on(t.apiKeyId, t.createdAt),
    index('ai_usage_record_source_created_idx').on(t.sourceType, t.sourceId, t.createdAt),
    index('ai_usage_record_created_at_idx').on(t.createdAt),
    check('ai_usage_record_attribution_check', sql`${t.apiKeyAttribution} IN (${sql.raw(attributionCheckValues)})`),
    check('ai_usage_record_auth_method_check', sql`${t.authMethod} IN (${sql.raw(authMethodCheckValues)})`),
    check('ai_usage_record_capture_source_check', sql`${t.captureSource} IN (${sql.raw(captureSourceCheckValues)})`),
    // NULL passes a CHECK in SQLite, so nullable columns need no IS NULL branch.
    check('ai_usage_record_cost_source_check', sql`${t.costSource} IN (${sql.raw(costSourceCheckValues)})`),
    // A cost is either wholly absent, or has the required amount/currency/source
    // tuple. Breakdown and pricing snapshots are optional audit detail, but
    // cannot exist without the core tuple. Explicit cost=0 remains valid.
    check(
      'ai_usage_record_cost_tuple_check',
      sql`(
        ${t.cost} IS NULL
        AND ${t.costCurrency} IS NULL
        AND ${t.costSource} IS NULL
        AND ${t.costBreakdown} IS NULL
        AND ${t.pricingSnapshot} IS NULL
      ) OR (
        ${t.cost} IS NOT NULL
        AND ${t.costCurrency} IS NOT NULL
        AND ${t.costSource} IS NOT NULL
      )`
    ),
    // Key-specific attributions carry the complete key snapshot identity;
    // provider-level or unresolved authentication carries none of it.
    check(
      'ai_usage_record_api_key_identity_check',
      sql`(
        ${t.apiKeyAttribution} IN ('explicit', 'matched', 'fallback')
        AND ${t.apiKeyId} IS NOT NULL
        AND ${t.authMethod} IS NULL
      ) OR (
        ${t.apiKeyAttribution} = 'auth'
        AND ${t.apiKeyId} IS NULL
        AND ${t.apiKeyLabel} IS NULL
        AND ${t.apiKeyMasked} IS NULL
        AND ${t.authMethod} IS NOT NULL
      ) OR (
        ${t.apiKeyAttribution} = 'unknown'
        AND ${t.apiKeyId} IS NULL
        AND ${t.apiKeyLabel} IS NULL
        AND ${t.apiKeyMasked} IS NULL
        AND ${t.authMethod} IS NULL
      )`
    ),
    check(
      'ai_usage_record_source_identity_check',
      sql`(
        ${t.sourceType} IS NULL
        AND ${t.sourceId} IS NULL
        AND ${t.sourceName} IS NULL
        AND ${t.sourceIcon} IS NULL
      ) OR (
        ${t.sourceType} IS NOT NULL
        AND ${t.sourceId} IS NOT NULL
      )`
    ),
    check('ai_usage_record_source_type_check', sql`${t.sourceType} IN (${sql.raw(sourceTypeCheckValues)})`),
    check('ai_usage_record_modality_check', sql`${t.modality} IN (${sql.raw(modalityCheckValues)})`),
    check(
      'ai_usage_record_image_count_check',
      sql`(
        ${t.modality} = 'image'
        AND ${t.imageCount} IS NOT NULL
        AND ${t.imageCount} > 0
      ) OR (
        ${t.modality} <> 'image'
        AND ${t.imageCount} IS NULL
      )`
    ),
    // Keep in sync with the shared provider-registry currency enum so GROUP BY
    // cannot silently split equivalent currency spellings.
    check('ai_usage_record_cost_currency_check', sql`${t.costCurrency} IN (${sql.raw(costCurrencyCheckValues)})`)
  ]
)

export type AiUsageRecordRow = typeof aiUsageRecordTable.$inferSelect
export type InsertAiUsageRecordRow = typeof aiUsageRecordTable.$inferInsert
