/**
 * Provider - Merged runtime provider type
 *
 * This is the "final state" after merging user config with preset.
 * Consumers don't need to know the source - they just use the merged config.
 *
 * Data source priority:
 * 1. user_provider (user configuration)
 * 2. providers.json (catalog preset)
 *
 * Zod schemas are the single source of truth — all types derived via z.infer<>
 */

import { EndpointType } from '@cherrystudio/provider-catalog'
import * as z from 'zod'

// ─── Schemas formerly from provider-catalog/schemas ─────────────────────────

const EndpointTypeSchema = z.enum(EndpointType)

/** API compatibility flags for provider-specific behaviors */
const CatalogApiCompatibilitySchema = z.object({
  arrayContent: z.boolean().optional(),
  streamOptions: z.boolean().optional(),
  developerRole: z.boolean().optional(),
  serviceTier: z.boolean().optional(),
  verbosity: z.boolean().optional(),
  enableThinking: z.boolean().optional(),
  requiresApiKey: z.boolean().optional()
})

/** Provider website schema (type used for catalog ProviderWebsite type) */
const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.string().url().optional(),
    docs: z.string().url().optional(),
    apiKey: z.string().url().optional(),
    models: z.string().url().optional()
  })
})

export type OpenAIServiceTier = 'auto' | 'default' | 'flex' | 'priority' | null | undefined
export type GroqServiceTier = 'auto' | 'on_demand' | 'flex' | undefined | null
export type ServiceTier = OpenAIServiceTier | GroqServiceTier

export const OpenAIServiceTiers = {
  auto: 'auto',
  default: 'default',
  flex: 'flex',
  priority: 'priority'
} as const

export const GroqServiceTiers = {
  auto: 'auto',
  on_demand: 'on_demand',
  flex: 'flex'
} as const

export function isOpenAIServiceTier(tier: string | null | undefined): tier is OpenAIServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(OpenAIServiceTiers, tier)
}

export function isGroqServiceTier(tier: string | undefined | null): tier is GroqServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(GroqServiceTiers, tier)
}

export function isServiceTier(tier: string | null | undefined): tier is ServiceTier {
  return isGroqServiceTier(tier) || isOpenAIServiceTier(tier)
}

export const ApiKeyEntrySchema = z.object({
  /** UUID for referencing this key */
  id: z.string(),
  /** Actual key value (encrypted in storage) */
  key: z.string(),
  /** User-friendly label */
  label: z.string().optional(),
  /** Whether this key is enabled */
  isEnabled: z.boolean(),
  /** Creation timestamp */
  createdAt: z.number().optional()
})

export type ApiKeyEntry = z.infer<typeof ApiKeyEntrySchema>
export const RuntimeApiKeySchema = ApiKeyEntrySchema.omit({ key: true })
export type RuntimeApiKey = z.infer<typeof RuntimeApiKeySchema>

export const AuthTypeSchema = z.enum(['api-key', 'oauth', 'iam-aws', 'iam-gcp', 'iam-azure'])
export type AuthType = z.infer<typeof AuthTypeSchema>

const AuthConfigApiKey = z.object({
  type: z.literal('api-key'),
  headerName: z.string().optional(),
  prefix: z.string().optional()
})

const AuthConfigOAuth = z.object({
  type: z.literal('oauth'),
  clientId: z.string(),
  refreshToken: z.string().optional(),
  accessToken: z.string().optional(),
  expiresAt: z.number().optional()
})

const AuthConfigIamAws = z.object({
  type: z.literal('iam-aws'),
  region: z.string(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional()
})

const AuthConfigIamGcp = z.object({
  type: z.literal('iam-gcp'),
  project: z.string(),
  location: z.string(),
  credentials: z.record(z.string(), z.unknown()).optional()
})

const AuthConfigIamAzure = z.object({
  type: z.literal('iam-azure'),
  apiVersion: z.string(),
  deploymentId: z.string().optional()
})

export const AuthConfigSchema = z.discriminatedUnion('type', [
  AuthConfigApiKey,
  AuthConfigOAuth,
  AuthConfigIamAws,
  AuthConfigIamGcp,
  AuthConfigIamAzure
])
export type AuthConfig = z.infer<typeof AuthConfigSchema>

export const ApiCompatibilitySchema = CatalogApiCompatibilitySchema
export type ApiCompatibility = z.infer<typeof ApiCompatibilitySchema>

export const RuntimeApiCompatibilitySchema = ApiCompatibilitySchema.required()
export type RuntimeApiCompatibility = z.infer<typeof RuntimeApiCompatibilitySchema>

export type ProviderWebsite = z.infer<typeof ProviderWebsiteSchema>

/** Flat website links schema for runtime Provider (without the catalog wrapper) */
export const ProviderWebsitesSchema = z.object({
  official: z.string().optional(),
  apiKey: z.string().optional(),
  docs: z.string().optional(),
  models: z.string().optional()
})

export type ProviderWebsites = z.infer<typeof ProviderWebsitesSchema>

export const ProviderSettingsSchema = z.object({
  // OpenAI / Groq
  serviceTier: z.string().optional(),
  verbosity: z.string().optional(),

  // Azure-specific
  apiVersion: z.string().optional(),

  // Anthropic
  cacheControl: z
    .object({
      enabled: z.boolean(),
      tokenThreshold: z.number().optional(),
      cacheSystemMessage: z.boolean().optional(),
      cacheLastNMessages: z.number().optional()
    })
    .optional(),

  // Common
  rateLimit: z.number().optional(),
  timeout: z.number().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),

  // User notes
  notes: z.string().optional()
})

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>

export const ProviderSchema = z.object({
  /** Provider ID */
  id: z.string(),
  /** Associated preset provider ID (if any) */
  presetProviderId: z.string().optional(),
  /** Display name */
  name: z.string(),
  /** Description */
  description: z.string().optional(),
  /** Base URL mapping (endpoint type → baseURL), sparse — only populated endpoints have entries */
  baseUrls: z.record(EndpointTypeSchema, z.url()).optional() as z.ZodOptional<
    z.ZodType<Partial<Record<EndpointType, string>>>
  >,
  modelsApiUrls: z
    .object({
      default: z.url().optional(),
      embedding: z.url().optional(),
      reranker: z.url().optional()
    })
    .optional(),
  /** Default text generation endpoint type */
  defaultChatEndpoint: EndpointTypeSchema.optional(),
  /** API Keys (without actual key values) */
  apiKeys: z.array(RuntimeApiKeySchema),
  /** Authentication type (no sensitive data) */
  authType: AuthTypeSchema,
  /** Merged feature support */
  apiCompatibility: RuntimeApiCompatibilitySchema,
  /** Provider settings */
  settings: ProviderSettingsSchema,
  /** Website links (official, apiKey, docs, models) */
  websites: ProviderWebsitesSchema.optional(),
  /** Whether this provider is enabled */
  isEnabled: z.boolean()
})

export type Provider = z.infer<typeof ProviderSchema>

export const DEFAULT_API_COMPATIBILITY: RuntimeApiCompatibility = {
  arrayContent: true,
  streamOptions: true,
  developerRole: false,
  serviceTier: false,
  verbosity: false,
  enableThinking: true,
  requiresApiKey: true
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {}
