/**
 * User Model table schema
 *
 * Stores all user models with fully resolved configurations.
 * Capabilities and settings are resolved once at add-time (from catalog),
 * so no runtime merge is needed.
 *
 * - presetModelId: traceability marker (which preset this came from, if any)
 * - Composite primary key: (providerId, modelId)
 *
 * Type definitions are sourced from @shared/data/types/model
 */
import type {
  EndpointType,
  Modality,
  ModelCapability,
  ParameterSupport,
  ReasoningConfig,
  RuntimeModelPricing
} from '@shared/data/types/model'
import { ParameterSupportDbSchema, ReasoningConfigSchema, RuntimeModelPricingSchema } from '@shared/data/types/model'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSchemaFactory } from 'drizzle-orm/zod'
import * as z from 'zod'

const { createInsertSchema, createSelectSchema } = createSchemaFactory({ zodInstance: z })

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

// ═══════════════════════════════════════════════════════════════════════════════
// Table Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const userModelTable = sqliteTable(
  'user_model',
  {
    id: uuidPrimaryKey(),

    /** User Provider ID */
    providerId: text().notNull(),

    /** Model ID (composite key part) */
    modelId: text().notNull(),

    /** Actual model ID used in API calls (may differ from modelId for aliased models) */
    modelApiId: text(),

    /** Associated preset model ID (for traceability) */
    presetModelId: text(),

    /** Display name (override or complete) */
    name: text(),

    /** Description */
    description: text(),

    /** UI grouping */
    group: text(),

    /** Complete capability list (resolved at add time) */
    capabilities: text({ mode: 'json' }).$type<ModelCapability[]>(),

    /** Supported input modalities (e.g., TEXT, VISION, AUDIO, VIDEO) */
    inputModalities: text({ mode: 'json' }).$type<Modality[]>(),

    /** Supported output modalities (e.g., TEXT, VISION, AUDIO, VIDEO, VECTOR) */
    outputModalities: text({ mode: 'json' }).$type<Modality[]>(),

    /** Endpoint types (optional, override Provider default) */
    endpointTypes: text({ mode: 'json' }).$type<EndpointType[]>(),

    /** Custom endpoint URL (optional, complete override) */
    customEndpointUrl: text(),

    /** Context window size */
    contextWindow: integer(),

    /** Maximum output tokens */
    maxOutputTokens: integer(),

    /** Streaming support */
    supportsStreaming: integer({ mode: 'boolean' }),

    /** Reasoning configuration */
    reasoning: text({ mode: 'json' }).$type<ReasoningConfig>(),

    /** Parameter support */
    parameters: text({ mode: 'json' }).$type<ParameterSupport>(),

    /** Pricing configuration */
    pricing: text({ mode: 'json' }).$type<RuntimeModelPricing>(),

    /** Whether this model is enabled */
    isEnabled: integer({ mode: 'boolean' }).default(true),

    /** Whether this model is hidden from lists */
    isHidden: integer({ mode: 'boolean' }).default(false),

    /** Sort order in UI */
    sortOrder: integer().default(0),

    /** User notes */
    notes: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    primaryKey({ columns: [t.providerId, t.modelId] }),
    index('user_model_preset_idx').on(t.presetModelId),
    index('user_model_provider_enabled_idx').on(t.providerId, t.isEnabled),
    index('user_model_provider_sort_idx').on(t.providerId, t.sortOrder)
  ]
)

// Export table type
export type UserModel = typeof userModelTable.$inferSelect
export type NewUserModel = typeof userModelTable.$inferInsert

const jsonColumnOverrides = {
  capabilities: () => z.array(z.number()).nullable(),
  inputModalities: () => z.array(z.number()).nullable(),
  outputModalities: () => z.array(z.number()).nullable(),
  endpointTypes: () => z.array(z.number()).nullable(),
  reasoning: () => ReasoningConfigSchema.nullable(),
  parameters: () => ParameterSupportDbSchema.nullable(),
  pricing: () => RuntimeModelPricingSchema.nullable()
}

export const userModelInsertSchema = createInsertSchema(userModelTable, jsonColumnOverrides)
export const userModelSelectSchema = createSelectSchema(userModelTable, jsonColumnOverrides)

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if this is a preset override or fully custom model */
export function isPresetOverride(model: UserModel): boolean {
  return model.presetModelId != null
}
