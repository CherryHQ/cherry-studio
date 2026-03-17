/**
 * User Provider table schema
 *
 * Core principle: One Provider instance = One apiHost (1:1 relationship)
 * One apiHost can have multiple API Keys (1:N relationship)
 *
 * Relationship with preset providers:
 * - presetProviderId links to catalog preset provider for inherited config
 * - If presetProviderId is null, this is a fully custom provider
 *
 */

import {
  type ApiFeatures,
  ApiFeaturesSchema,
  type ApiKeyEntry,
  ApiKeyEntrySchema,
  type AuthConfig,
  AuthConfigSchema,
  type ProviderSettings,
  ProviderSettingsSchema,
  type ProviderWebsites,
  ProviderWebsitesSchema
} from '@shared/data/types/provider'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createSchemaFactory } from 'drizzle-zod'
import * as z from 'zod'

const { createInsertSchema, createSelectSchema } = createSchemaFactory({ zodInstance: z })

import type { EndpointType } from '@shared/data/types/model'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const userProviderTable = sqliteTable(
  'user_provider',
  {
    id: uuidPrimaryKey(),

    providerId: text().notNull().unique(),

    /** Associated preset provider ID (optional)
     * Links to catalog provider for inherited API format and defaults
     * If null, this is a fully custom provider requiring manual endpoint config
     */
    presetProviderId: text(),

    name: text().notNull(),

    baseUrls: text('base_urls', { mode: 'json' }).$type<Partial<Record<EndpointType, string>>>(),

    modelsApiUrls: text('models_api_urls', { mode: 'json' }).$type<Record<string, string>>(),

    /** Default text generation endpoint (when supporting multiple) */
    defaultChatEndpoint: text().$type<EndpointType>(),

    /** API Keys array */
    apiKeys: text({ mode: 'json' }).$type<ApiKeyEntry[]>().default([]),

    /** Unified auth configuration for different auth methods */
    authConfig: text({ mode: 'json' }).$type<AuthConfig>(),

    /** API feature support (null = use preset default) */
    apiFeatures: text('api_features', { mode: 'json' }).$type<ApiFeatures>(),

    /** Provider-specific settings as JSON */
    providerSettings: text({ mode: 'json' }).$type<ProviderSettings>(),

    /** How this provider's API expects reasoning parameters (e.g. 'openai-chat', 'anthropic', 'enable-thinking') */
    reasoningFormatType: text(),

    /** Website links (official, apiKey, docs, models) */
    websites: text({ mode: 'json' }).$type<ProviderWebsites>(),

    /** Whether this provider is enabled */
    isEnabled: integer({ mode: 'boolean' }).default(true),

    /** Sort order in UI */
    sortOrder: integer().default(0),

    ...createUpdateTimestamps
  },
  (t) => [
    index('user_provider_preset_idx').on(t.presetProviderId),
    index('user_provider_enabled_sort_idx').on(t.isEnabled, t.sortOrder)
  ]
)

// Export table type
export type UserProvider = typeof userProviderTable.$inferSelect
export type NewUserProvider = typeof userProviderTable.$inferInsert

const jsonColumnOverrides = {
  baseUrls: () => z.record(z.string(), z.string()).nullable(),
  modelsApiUrls: () => z.record(z.string(), z.string()).nullable(),
  apiKeys: () => z.array(ApiKeyEntrySchema).nullable(),
  authConfig: () => AuthConfigSchema.nullable(),
  apiFeatures: () => ApiFeaturesSchema.nullable(),
  providerSettings: () => ProviderSettingsSchema.nullable(),
  websites: () => ProviderWebsitesSchema.nullable()
}

export const userProviderInsertSchema = createInsertSchema(userProviderTable, jsonColumnOverrides)
export const userProviderSelectSchema = createSelectSchema(userProviderTable, jsonColumnOverrides)
