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

import type { EndpointType } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, objectValues } from '@cherrystudio/provider-registry'
import * as z from 'zod'

// ─── Schemas formerly from provider-registry/schemas ─────────────────────────

const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))

/** API feature flags controlling request construction at the SDK level */
const CatalogApiFeaturesSchema = z.object({
  arrayContent: z.boolean().optional(),
  streamOptions: z.boolean().optional(),
  developerRole: z.boolean().optional(),
  serviceTier: z.boolean().optional(),
  verbosity: z.boolean().optional()
})

/** Provider website schema (type used for catalog ProviderWebsite type) */
const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.url().optional(),
    docs: z.url().optional(),
    apiKey: z.url().optional(),
    models: z.url().optional()
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
  isEnabled: z.boolean()
})

export type ApiKeyEntry = z.infer<typeof ApiKeyEntrySchema>
export const RuntimeApiKeySchema = ApiKeyEntrySchema.omit({ key: true })
export type RuntimeApiKey = z.infer<typeof RuntimeApiKeySchema>

export const AuthTypeSchema = z.enum(['api-key', 'oauth', 'iam-aws', 'iam-gcp', 'iam-azure'])
export type AuthType = z.infer<typeof AuthTypeSchema>

const AuthConfigApiKey = z.object({
  type: z.literal('api-key'),
  headerName: z.string().optional(),
  prefix: z.string().optional(),
  /** Whether the provider requires an API key (false for local providers like Ollama) */
  required: z.boolean().optional()
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

export const ApiFeaturesSchema = CatalogApiFeaturesSchema
export type ApiFeatures = z.infer<typeof ApiFeaturesSchema>

export const RuntimeApiFeaturesSchema = ApiFeaturesSchema.required()
export type RuntimeApiFeatures = z.infer<typeof RuntimeApiFeaturesSchema>

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

  // Ollama / LMStudio / GPUStack
  keepAliveTime: z.number().optional(),

  // Common
  rateLimit: z.number().optional(),
  timeout: z.number().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),

  // User notes
  notes: z.string().optional(),

  // GitHub Copilot auth state (stored here because v2 Provider has no isAuthed column)
  isAuthed: z.boolean().optional(),
  oauthUsername: z.string().optional(),
  oauthAvatar: z.string().optional()
})

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>

export const REASONING_FORMAT_TYPES = [
  'openai-chat',
  'openai-responses',
  'anthropic',
  'gemini',
  'openrouter',
  'enable-thinking',
  'thinking-type',
  'dashscope',
  'self-hosted'
] as const

export const ReasoningFormatTypeSchema = z.enum(REASONING_FORMAT_TYPES)
export type ReasoningFormatType = z.infer<typeof ReasoningFormatTypeSchema>

/** URLs for fetching available models, separated by model category */
export const ModelsApiUrlsSchema = z.object({
  default: z.string().optional(),
  embedding: z.string().optional(),
  reranker: z.string().optional()
})

export type ModelsApiUrls = z.infer<typeof ModelsApiUrlsSchema>

/** Per-endpoint-type configuration */
export const EndpointConfigSchema = z.object({
  /** Base URL for this endpoint type's API */
  baseUrl: z.string().optional(),
  /** How this endpoint type expects reasoning parameters */
  reasoningFormatType: ReasoningFormatTypeSchema.optional(),
  /** URLs for fetching available models via this endpoint type */
  modelsApiUrls: ModelsApiUrlsSchema.optional(),
  /** AI SDK adapter family that handles this endpoint. Carried over from the catalog */
  adapterFamily: z.string().optional()
})

export type EndpointConfig = z.infer<typeof EndpointConfigSchema>

export const ProviderSchema = z.object({
  /** Provider ID */
  id: z.string(),
  /** Associated preset provider ID (if any) */
  presetProviderId: z.string().optional(),
  /** Display name */
  name: z.string(),
  /** Description */
  description: z.string().optional(),
  /** Per-endpoint-type configuration (baseUrl, reasoningFormatType, modelsApiUrls) */
  endpointConfigs: z.record(EndpointTypeSchema, EndpointConfigSchema).optional() as z.ZodOptional<
    z.ZodType<Partial<Record<EndpointType, EndpointConfig>>>
  >,
  /** Default text generation endpoint type */
  defaultChatEndpoint: EndpointTypeSchema.optional(),
  /** API Keys (without actual key values) */
  apiKeys: z.array(RuntimeApiKeySchema),
  /** Authentication type (no sensitive data) */
  authType: AuthTypeSchema,
  /** Merged API feature support */
  apiFeatures: RuntimeApiFeaturesSchema,
  /** Provider settings */
  settings: ProviderSettingsSchema,
  /** Whether this provider is enabled */
  isEnabled: z.boolean()
})

export type Provider = z.infer<typeof ProviderSchema>

export const DEFAULT_API_FEATURES: RuntimeApiFeatures = {
  arrayContent: true,
  streamOptions: true,
  developerRole: false,
  serviceTier: false,
  verbosity: false
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {}
