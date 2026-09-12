import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import {
  type AiUsageCostBreakdown,
  type AiUsagePricingSnapshot,
  type AiUsageRecordAttribution,
  AiUsageRecordAttributionSchema,
  type AiUsageRecordAuthMethod,
  AiUsageRecordAuthMethodSchema,
  type AiUsageRecordCostSource,
  AiUsageRecordCostSourceSchema,
  type AiUsageRecordKind,
  AiUsageRecordKindSchema,
  type AiUsageRecordMessageKind,
  AiUsageRecordMessageKindSchema,
  type AiUsageRecordModality,
  AiUsageRecordModalitySchema,
  type AiUsageRecordSourceType,
  AiUsageRecordSourceTypeSchema
} from '@shared/data/types/aiUsageRecord'
import { CURRENCY, type Currency, objectValues } from '@shared/data/types/model'

import { uuidPrimaryKeyOrdered } from './_columnHelpers'

const sqlEnumValues = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ')
const attributionCheckValues = sqlEnumValues(AiUsageRecordAttributionSchema.options)
const authMethodCheckValues = sqlEnumValues(AiUsageRecordAuthMethodSchema.options)
const costCurrencyCheckValues = sqlEnumValues(objectValues(CURRENCY))
const costSourceCheckValues = sqlEnumValues(AiUsageRecordCostSourceSchema.options)
const messageKindCheckValues = sqlEnumValues(AiUsageRecordMessageKindSchema.options)
const modalityCheckValues = sqlEnumValues(AiUsageRecordModalitySchema.options)
const recordKindCheckValues = sqlEnumValues(AiUsageRecordKindSchema.options)
const sourceTypeCheckValues = sqlEnumValues(AiUsageRecordSourceTypeSchema.options)

/**
 * Immutable best-effort fact for one observable provider invocation.
 *
 * Historical v1 assistant-message aggregates share this table with
 * `recordKind = 'legacy-aggregate'`. All identities are request-time snapshots
 * and deliberately have no foreign keys so later rename/deletion cannot change
 * attribution.
 */
export const aiUsageRecordTable = sqliteTable(
  'ai_usage_record',
  {
    id: uuidPrimaryKeyOrdered(),
    requestId: text().notNull(),
    recordKind: text().$type<AiUsageRecordKind>().notNull(),
    requestCount: integer().notNull(),
    messageKind: text().$type<AiUsageRecordMessageKind>(),
    messageId: text(),

    providerId: text(),
    providerName: text(),
    modelId: text(),
    modelName: text(),
    sourceType: text().$type<AiUsageRecordSourceType>(),
    sourceId: text(),
    sourceName: text(),
    sourceIcon: text(),
    modality: text().$type<AiUsageRecordModality>().notNull(),

    apiKeyId: text(),
    apiKeyLabel: text(),
    apiKeyMasked: text(),
    apiKeyAttribution: text().$type<AiUsageRecordAttribution>().notNull(),
    authMethod: text().$type<AiUsageRecordAuthMethod>(),

    inputTokens: integer(),
    outputTokens: integer(),
    totalTokens: integer(),
    reasoningTokens: integer(),
    noCacheTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    imageCount: integer(),

    cost: real(),
    costCurrency: text().$type<Currency>(),
    costSource: text().$type<AiUsageRecordCostSource>(),
    costBreakdown: text({ mode: 'json' }).$type<AiUsageCostBreakdown>(),
    pricingSnapshot: text({ mode: 'json' }).$type<AiUsagePricingSnapshot>(),

    timeFirstTokenMs: integer(),
    timeCompletionMs: integer(),
    timeThinkingMs: integer(),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (t) => [
    uniqueIndex('ai_usage_record_request_id_idx').on(t.requestId),
    index('ai_usage_record_created_at_idx').on(t.createdAt),
    index('ai_usage_record_message_created_idx').on(t.messageKind, t.messageId, t.createdAt),
    index('ai_usage_record_provider_created_idx').on(t.providerId, t.createdAt),
    index('ai_usage_record_model_created_idx').on(t.modelId, t.createdAt),
    index('ai_usage_record_api_key_created_idx').on(t.apiKeyId, t.createdAt),
    index('ai_usage_record_source_created_idx').on(t.sourceType, t.sourceId, t.createdAt),

    check('ai_usage_record_record_kind_check', sql`${t.recordKind} IN (${sql.raw(recordKindCheckValues)})`),
    check('ai_usage_record_message_kind_check', sql`${t.messageKind} IN (${sql.raw(messageKindCheckValues)})`),
    check('ai_usage_record_source_type_check', sql`${t.sourceType} IN (${sql.raw(sourceTypeCheckValues)})`),
    check('ai_usage_record_modality_check', sql`${t.modality} IN (${sql.raw(modalityCheckValues)})`),
    check('ai_usage_record_attribution_check', sql`${t.apiKeyAttribution} IN (${sql.raw(attributionCheckValues)})`),
    check('ai_usage_record_auth_method_check', sql`${t.authMethod} IN (${sql.raw(authMethodCheckValues)})`),
    check('ai_usage_record_cost_source_check', sql`${t.costSource} IN (${sql.raw(costSourceCheckValues)})`),
    check('ai_usage_record_cost_currency_check', sql`${t.costCurrency} IN (${sql.raw(costCurrencyCheckValues)})`),

    check(
      'ai_usage_record_kind_identity_check',
      sql`(
        ${t.recordKind} = 'invocation'
        AND ${t.requestCount} = 1
        AND ${t.providerId} IS NOT NULL
        AND ${t.modelId} IS NOT NULL
      ) OR (
        ${t.recordKind} = 'legacy-aggregate'
        AND ${t.requestCount} >= 1
        AND ${t.messageKind} IS NOT NULL
        AND ${t.messageId} IS NOT NULL
      )`
    ),
    check(
      'ai_usage_record_message_identity_check',
      sql`(${t.messageKind} IS NULL AND ${t.messageId} IS NULL)
        OR (${t.messageKind} IS NOT NULL AND ${t.messageId} IS NOT NULL)`
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
    check(
      'ai_usage_record_api_key_identity_check',
      sql`(
        ${t.apiKeyAttribution} IN ('explicit', 'matched')
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
      'ai_usage_record_cost_tuple_check',
      sql`(
        ${t.cost} IS NULL
        AND ${t.costCurrency} IS NULL
        AND ${t.costSource} IS NULL
        AND ${t.costBreakdown} IS NULL
      ) OR (
        ${t.cost} IS NOT NULL
        AND ${t.costCurrency} IS NOT NULL
        AND ${t.costSource} IS NOT NULL
      )`
    ),
    check(
      'ai_usage_record_image_count_check',
      sql`(
        ${t.modality} = 'image'
        AND ${t.imageCount} IS NOT NULL
        AND ${t.imageCount} >= 0
      ) OR (
        ${t.modality} <> 'image'
        AND ${t.imageCount} IS NULL
      )`
    ),
    check(
      'ai_usage_record_nonnegative_check',
      sql`
        (${t.inputTokens} IS NULL OR ${t.inputTokens} >= 0)
        AND (${t.outputTokens} IS NULL OR ${t.outputTokens} >= 0)
        AND (${t.totalTokens} IS NULL OR ${t.totalTokens} >= 0)
        AND (${t.reasoningTokens} IS NULL OR ${t.reasoningTokens} >= 0)
        AND (${t.noCacheTokens} IS NULL OR ${t.noCacheTokens} >= 0)
        AND (${t.cacheReadTokens} IS NULL OR ${t.cacheReadTokens} >= 0)
        AND (${t.cacheWriteTokens} IS NULL OR ${t.cacheWriteTokens} >= 0)
        AND (${t.cost} IS NULL OR ${t.cost} >= 0)
        AND (${t.timeFirstTokenMs} IS NULL OR ${t.timeFirstTokenMs} >= 0)
        AND (${t.timeCompletionMs} IS NULL OR ${t.timeCompletionMs} >= 0)
        AND (${t.timeThinkingMs} IS NULL OR ${t.timeThinkingMs} >= 0)
      `
    ),
    check(
      'ai_usage_record_integer_check',
      sql`
        typeof(${t.requestCount}) = 'integer'
        AND (${t.inputTokens} IS NULL OR typeof(${t.inputTokens}) = 'integer')
        AND (${t.outputTokens} IS NULL OR typeof(${t.outputTokens}) = 'integer')
        AND (${t.totalTokens} IS NULL OR typeof(${t.totalTokens}) = 'integer')
        AND (${t.reasoningTokens} IS NULL OR typeof(${t.reasoningTokens}) = 'integer')
        AND (${t.noCacheTokens} IS NULL OR typeof(${t.noCacheTokens}) = 'integer')
        AND (${t.cacheReadTokens} IS NULL OR typeof(${t.cacheReadTokens}) = 'integer')
        AND (${t.cacheWriteTokens} IS NULL OR typeof(${t.cacheWriteTokens}) = 'integer')
        AND (${t.imageCount} IS NULL OR typeof(${t.imageCount}) = 'integer')
        AND (${t.timeFirstTokenMs} IS NULL OR typeof(${t.timeFirstTokenMs}) = 'integer')
        AND (${t.timeCompletionMs} IS NULL OR typeof(${t.timeCompletionMs}) = 'integer')
        AND (${t.timeThinkingMs} IS NULL OR typeof(${t.timeThinkingMs}) = 'integer')
        AND typeof(${t.createdAt}) = 'integer'
      `
    ),
    check('ai_usage_record_finite_cost_check', sql`${t.cost} IS NULL OR ${t.cost} <= 1.7976931348623157e308`)
  ]
)

export type AiUsageRecordRow = typeof aiUsageRecordTable.$inferSelect
export type InsertAiUsageRecordRow = typeof aiUsageRecordTable.$inferInsert
