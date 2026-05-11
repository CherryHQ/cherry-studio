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

import type { EndpointType } from '@shared/data/types/model'
import type {
  ApiFeatures,
  ApiKeyEntry,
  AuthConfig,
  EndpointConfig,
  ProviderSettings
} from '@shared/data/types/provider'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export const userProviderTable = sqliteTable(
  'user_provider',
  {
    providerId: text().primaryKey(),

    /** Associated preset provider ID (optional)
     * Links to catalog provider for inherited API format and defaults
     * If null, this is a fully custom provider requiring manual endpoint config
     */
    presetProviderId: text(),

    name: text().notNull(),

    /** Per-endpoint-type configuration (baseUrl, reasoningFormatType, modelsApiUrls) */
    endpointConfigs: text('endpoint_configs', { mode: 'json' }).$type<Partial<Record<EndpointType, EndpointConfig>>>(),

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

    /** Whether this provider is enabled */
    isEnabled: integer({ mode: 'boolean' }).notNull().default(true),

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
