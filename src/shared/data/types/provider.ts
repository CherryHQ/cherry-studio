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

import type { EndpointType, ServerTool, ServerToolConfig } from '@cherrystudio/provider-registry'
import {
  CURRENCY,
  ENDPOINT_TYPE,
  FastModeTransportSchema,
  objectValues,
  ProviderEditionSchema,
  ProviderReasoningFormatSchema,
  ProviderReasoningFormatSelectorSchema,
  ServerToolConfigSchema
} from '@cherrystudio/provider-registry'
import * as z from 'zod'

export type { ServerTool, ServerToolConfig }

// ─── Schemas formerly from provider-registry/schemas ─────────────────────────

const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))

/**
 * How a host deviates from one endpoint's dialect. Endpoint-scoped because a
 * provider serving both chat-completions and Responses may answer differently
 * for each.
 */
export const EndpointDialectSchema = z.object({
  /** Accepts chat-completions `stream_options` for usage data. Absent ⇒ true. */
  streamOptions: z.boolean().optional(),
  /** Accepts messages with `role: "developer"`. Absent ⇒ false. */
  developerRole: z.boolean().optional(),
  /** Accepts OpenAI Responses `reasoning.summary`. Absent ⇒ use the registry wire. */
  reasoningSummary: z.boolean().optional()
})

export type EndpointDialect = z.infer<typeof EndpointDialectSchema>

/** Provider website schema (type used for catalog ProviderWebsite type) */
const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.url().optional(),
    docs: z.url().optional(),
    apiKey: z.url().optional(),
    models: z.url().optional()
  })
})

export const ApiKeyEntrySchema = z.object({
  /** UUID for referencing this key */
  id: z.string().min(1),
  /** Actual key value (trimmed; empty values are rejected) */
  key: z.string().trim().min(1),
  /** User-friendly label */
  label: z.string().optional(),
  /** Whether this key is enabled */
  isEnabled: z.boolean()
})

export type ApiKeyEntry = z.infer<typeof ApiKeyEntrySchema>
export const RuntimeApiKeySchema = ApiKeyEntrySchema.omit({ key: true })
export type RuntimeApiKey = z.infer<typeof RuntimeApiKeySchema>

export const AuthTypeSchema = z.enum(['api-key', 'oauth', 'iam-aws', 'api-key-aws', 'iam-gcp', 'iam-azure'])
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
  expiresAt: z.number().optional(),
  /**
   * Provider account identifier extracted from the OAuth access token, when the
   * provider needs it as a request header (e.g. OpenAI Codex's
   * `chatgpt-account-id`). Not every OAuth provider populates this.
   */
  accountId: z.string().optional()
})

const AuthConfigIamAws = z.object({
  type: z.literal('iam-aws'),
  region: z.string(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional()
})

/**
 * AWS Bedrock api-key auth. AWS issues short-lived bearer tokens that work
 * as a `Bearer` header against the regional Bedrock endpoint, so this still
 * needs a region — region is *not* in the generic `api-key` variant because
 * only AWS uses it that way.
 */
const AuthConfigApiKeyAws = z.object({
  type: z.literal('api-key-aws'),
  region: z.string()
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
  AuthConfigApiKeyAws,
  AuthConfigIamGcp,
  AuthConfigIamAzure
])
export type AuthConfig = z.infer<typeof AuthConfigSchema>
/** The OAuth variant of {@link AuthConfig}, narrowed for token-bearing providers. */
export type OAuthAuthConfig = Extract<AuthConfig, { type: 'oauth' }>

export type ProviderWebsite = z.infer<typeof ProviderWebsiteSchema>

/** Flat website links schema for runtime Provider (without the catalog wrapper) */
export const ProviderWebsitesSchema = z.object({
  official: z.string().optional(),
  apiKey: z.string().optional(),
  docs: z.string().optional(),
  models: z.string().optional()
})

export type ProviderWebsites = z.infer<typeof ProviderWebsitesSchema>

export const ANTHROPIC_CACHE_TTL_OPTIONS = ['5m', '1h'] as const
const AnthropicCacheTtlSchema = z.enum(ANTHROPIC_CACHE_TTL_OPTIONS)
export type AnthropicCacheTtl = z.infer<typeof AnthropicCacheTtlSchema>

export const ProviderSettingsSchema = z.object({
  streamOptions: z
    .object({
      includeUsage: z.boolean().optional()
    })
    .optional(),

  // Azure-specific
  apiVersion: z.string().optional(),

  // Anthropic
  cacheControl: z
    .object({
      enabled: z.boolean(),
      tokenThreshold: z.number().optional(),
      cacheSystemMessage: z.boolean().optional(),
      cacheLastNMessages: z.number().optional(),
      ttl: AnthropicCacheTtlSchema.optional()
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

/** URLs for fetching available models, separated by model category */
export const ModelsApiUrlsSchema = z.object({
  default: z.string().optional(),
  embedding: z.string().optional(),
  image: z.string().optional(),
  reranker: z.string().optional()
})

export type ModelsApiUrls = z.infer<typeof ModelsApiUrlsSchema>

/** Per-endpoint-type configuration */
export const EndpointConfigSchema = z.object({
  /** Base URL for this endpoint type's API */
  baseUrl: z.string().optional(),
  /** URLs for fetching available models via this endpoint type */
  modelsApiUrls: ModelsApiUrlsSchema.optional(),
  /** AI SDK adapter family that handles this endpoint. Carried over from the catalog */
  adapterFamily: z.string().optional(),
  /** Dialect deviations of this host's implementation of the endpoint */
  dialect: EndpointDialectSchema.optional(),
  /** How this endpoint expects reasoning parameters to be formatted (e.g. `self-hosted` for vLLM/SGLang relays). */
  reasoningFormat: ProviderReasoningFormatSchema.optional()
})

export type EndpointConfig = z.infer<typeof EndpointConfigSchema>

/**
 * The row-persisted subset of {@link EndpointConfigSchema} — only fields the
 * user explicitly owns. Registry-owned fields (`modelsApiUrls`,
 * `adapterFamily`) resolve from the registry at read time; persisting them
 * through the renderer write contract would freeze a snapshot that goes stale
 * (#17096). The reasoning format selector never carries the main-only wire.
 */
export const EndpointConfigOverrideSchema = z.object({
  /** User-owned base URL override for this endpoint type's API */
  baseUrl: z.string().optional(),
  /** User-owned dialect overrides — the only way a custom provider states its deviations */
  dialect: EndpointDialectSchema.optional(),
  /** User-owned reasoning format selector for this endpoint type's API. */
  reasoningFormat: ProviderReasoningFormatSelectorSchema.optional()
})

export type EndpointConfigOverride = z.infer<typeof EndpointConfigOverrideSchema>

export const ProviderSchema = z.object({
  /** Provider ID */
  id: z.string(),
  /** Associated preset provider ID (if any) */
  presetProviderId: z.string().optional(),
  /** Display name */
  name: z.string(),
  /**
   * Preset logo key — a `icon:<providerId>` brand-icon ref. Absent for preset
   * providers rendered by id, and for custom providers with an uploaded logo
   * (those carry {@link logoSrc} instead). Never a URL or data URL.
   */
  logo: z.string().optional(),
  /**
   * Ready-to-render URL for an uploaded logo, resolved main-side from the
   * `file_entry` (`file://…`). Mutually exclusive with {@link logo}. The
   * renderer renders it directly and never reconstructs a disk path — the file
   * storage layout stays a main-process detail.
   */
  logoSrc: z.string().optional(),
  /** Description */
  description: z.string().optional(),
  /**
   * App editions where this provider is available. Omitted means all editions.
   * Other-edition rows remain persisted, but ordinary runtime reads and user mutations treat them as unavailable.
   */
  availableInEditions: z.array(ProviderEditionSchema).min(1).optional(),
  /** Preset provider website links */
  websites: ProviderWebsitesSchema.optional(),
  /** Per-endpoint-type connection configuration */
  endpointConfigs: z.record(EndpointTypeSchema, EndpointConfigSchema).optional() as z.ZodOptional<
    z.ZodType<Partial<Record<EndpointType, EndpointConfig>>>
  >,
  /** Default text generation endpoint type */
  defaultChatEndpoint: EndpointTypeSchema.optional(),
  /**
   * Where the model list comes from. `'registry'` providers cannot enumerate
   * models over an API; the shipped catalog is returned instead. Carried from
   * the registry; absent/`'api'` for normal providers.
   */
  modelListSource: z.enum(['api', 'registry']).optional(),
  /** Provider-native (server-executed) built-in tools resolved from the registry. */
  serverTools: z.array(ServerToolConfigSchema).optional(),
  /**
   * Which credential kinds this provider accepts (`'api-key'` / `'oauth'` /
   * `'external-cli'`) — a set, since a provider can offer more than one (CherryIN
   * takes both a user key and an OAuth login). Carried from the registry; absent
   * ⇒ `['api-key']`. "Login-based" is the derived `!includes('api-key')`. See
   * {@link isLoginBasedProvider}.
   */
  authMethods: z.array(z.enum(['api-key', 'oauth', 'external-cli'])).optional(),
  /**
   * Registry capability: the provider serves requests without any credential
   * (local server — ollama / lmstudio / gpustack / ovms), so the missing-API-key
   * guards (model sync, painting/OpenClaw gating) skip the key check. Carried
   * from the registry; absent ⇒ false.
   */
  authOptional: z.boolean().optional(),
  /**
   * Registry-owned currency for provider-reported costs that omit currency
   * from the wire payload. Never inferred for custom providers.
   */
  reportedCostCurrency: z.enum(objectValues(CURRENCY)).optional(),
  /** Whether usage responses carry the actual billed amount. */
  reportsActualCost: z.boolean(),
  /** Provider-owned transport for Fast requests. Effective availability is model-specific. */
  fastMode: z.object({ transport: FastModeTransportSchema, serviceTier: z.string().optional() }).optional(),
  /** API Keys (without actual key values) */
  apiKeys: z.array(RuntimeApiKeySchema),
  /** Authentication type (no sensitive data) */
  authType: AuthTypeSchema,
  /** Provider settings */
  settings: ProviderSettingsSchema,
  /** Whether this provider is enabled */
  isEnabled: z.boolean()
})

export type Provider = z.infer<typeof ProviderSchema>

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {}
