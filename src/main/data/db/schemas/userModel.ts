/**
 * User Model table schema
 *
 * Stores complete custom models and user-owned deltas for preset-backed models.
 * Preset-backed runtime models resolve from the current registry on every read;
 * each non-null config column is the corresponding user-owned delta.
 *
 * - presetModelId: traceability marker (which preset this came from, if any)
 * - Single PK: id = "providerId::modelId" (deterministic UniqueModelId)
 * - providerId FK → user_provider (ON DELETE CASCADE)
 *
 * Type definitions are sourced from @shared/data/types/model
 */
import type {
  EndpointType,
  Modality,
  ModelCapability,
  ParameterSupport,
  ReasoningConfig,
  RuntimeModelPricing,
  ServerToolOverrides
} from '@shared/data/types/model'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex } from './_columnHelpers'
import { userProviderTable } from './userProvider'

// ═══════════════════════════════════════════════════════════════════════════════
// Table Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const userModelTable = sqliteTable(
  'user_model',
  {
    /** Deterministic PK: "providerId::modelId" (UniqueModelId) */
    id: text().primaryKey(),

    /** User Provider ID — FK to user_provider */
    providerId: text()
      .notNull()
      .references(() => userProviderTable.providerId, { onDelete: 'cascade' }),

    /** Model ID (raw, without provider prefix) */
    modelId: text().notNull(),

    /** Associated preset model ID (for traceability) */
    presetModelId: text(),

    /** Display name (custom value or preset override; null inherits the preset) */
    name: text(),

    /** Description */
    description: text(),

    /** UI grouping */
    group: text(),

    /** Custom capabilities or an exact preset override; null inherits the preset */
    capabilities: text({ mode: 'json' }).$type<ModelCapability[]>(),

    /** User overrides for model-dependent provider-native tool eligibility. */
    serverToolOverrides: text({ mode: 'json' }).$type<ServerToolOverrides>(),

    /** Supported input modalities (e.g., TEXT, VISION, AUDIO, VIDEO) */
    inputModalities: text({ mode: 'json' }).$type<Modality[]>(),

    /** Supported output modalities (e.g., TEXT, VISION, AUDIO, VIDEO, VECTOR) */
    outputModalities: text({ mode: 'json' }).$type<Modality[]>(),

    /** Endpoint types (optional, override Provider default) */
    endpointTypes: text({ mode: 'json' }).$type<EndpointType[]>(),

    /** Context window size */
    contextWindow: integer(),

    /** Maximum input tokens */
    maxInputTokens: integer(),

    /** Maximum output tokens */
    maxOutputTokens: integer(),

    /** Streaming support (null inherits the preset) */
    supportsStreaming: integer({ mode: 'boolean' }),

    /** Reasoning configuration */
    reasoning: text({ mode: 'json' }).$type<ReasoningConfig>(),

    /** Parameter support */
    parameters: text({ mode: 'json' }).$type<ParameterSupport>(),

    /** Pricing configuration */
    pricing: text({ mode: 'json' }).$type<RuntimeModelPricing>(),

    /** Whether this model is enabled */
    isEnabled: integer({ mode: 'boolean' }).notNull().default(true),

    /** Whether this model is hidden from lists */
    isHidden: integer({ mode: 'boolean' }).notNull().default(false),

    /** Whether this model has been deprecated by the provider (no longer in API model list) */
    isDeprecated: integer({ mode: 'boolean' }).notNull().default(false),

    /** Fractional-indexing order key scoped within provider. */
    ...orderKeyColumns,

    /** User notes */
    notes: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check(
      'user_model_custom_config_check',
      sql`${t.presetModelId} IS NOT NULL OR (${t.name} IS NOT NULL AND ${t.capabilities} IS NOT NULL AND ${t.supportsStreaming} IS NOT NULL)`
    ),
    unique('user_model_provider_model_unique').on(t.providerId, t.modelId),
    index('user_model_preset_idx').on(t.presetModelId),
    index('user_model_provider_enabled_idx').on(t.providerId, t.isEnabled),
    scopedOrderKeyIndex('user_model', 'providerId')(t)
  ]
)

// Export table type
export type UserModelRow = typeof userModelTable.$inferSelect
export type InsertUserModelRow = typeof userModelTable.$inferInsert

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if this is a preset override or fully custom model */
export function isPresetOverride(model: UserModelRow): boolean {
  return model.presetModelId != null
}
