/**
 * Provider configuration schema definitions
 * Defines the structure for provider connections and API configurations
 */

import * as z from 'zod'

import { VENDOR_PATTERNS, type VendorKey } from '../patterns/vendor-patterns'
import { MetadataSchema, ProviderIdSchema, VersionSchema, ZodCurrencySchema } from './common'
import { ENDPOINT_TYPE, type EndpointType, objectValues, SERVER_TOOL, SERVER_TOOL_MODEL_SCOPE } from './enums'
import { ReasoningWireProfileSchema } from './reasoningWire'

export const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))
const endpointTypeValues: readonly string[] = objectValues(ENDPOINT_TYPE)

// ═══════════════════════════════════════════════════════════════════════════════
// API Features
// ═══════════════════════════════════════════════════════════════════════════════

/** API feature flags controlling request construction at the SDK level */
export const ApiFeaturesSchema = z.object({
  // --- Request format flags ---

  /** Whether the provider supports array-formatted content in messages */
  arrayContent: z.boolean().default(true),
  /** Whether the provider supports stream_options for usage data */
  streamOptions: z.boolean().default(true),

  // --- Provider-specific parameter flags ---

  /** Whether the provider supports the 'developer' role (OpenAI-specific) */
  developerRole: z.boolean().default(false),
  /** Whether the provider supports service tier selection (OpenAI/Groq-specific) */
  serviceTier: z.boolean().default(false),
  /** Whether the provider supports verbosity settings (OpenAI-specific) */
  verbosity: z.boolean().default(false),

  // --- Response feature flags ---

  /** Whether the provider returns the actual billed cost in its usage response */
  reportsActualCost: z.boolean().default(false)
})

/**
 * Provider-owned transport used to request faster processing.
 *
 * Model availability remains a provider-model concern; this only describes
 * how the provider carries an enabled Fast request.
 */
export const FastModeTransportSchema = z.enum(['openai-priority', 'claude-code'])

/** A provider-native tool plus the scope of models on which the host serves it. */
export const ServerToolConfigSchema = z.object({
  id: z.enum(objectValues(SERVER_TOOL)),
  modelScope: z.enum(objectValues(SERVER_TOOL_MODEL_SCOPE)).default(SERVER_TOOL_MODEL_SCOPE.MODEL_DEPENDENT),
  /**
   * Vendor families the host actually serves the tool for, when narrower than
   * the tool's model eligibility (e.g. Vertex url-context is Gemini-only: the
   * vertex-anthropic SDK exposes no webFetch tool). Absent ⇒ no narrowing.
   */
  vendors: z.array(z.enum(Object.keys(VENDOR_PATTERNS) as [VendorKey, ...VendorKey[]])).optional()
})

export type ServerToolConfig = z.infer<typeof ServerToolConfigSchema>

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Reasoning Format
//
// Describes HOW a provider's API expects reasoning parameters to be formatted.
// This is a provider-level concern — model-level reasoning capabilities
// (effort levels, token limits) are in model.ts ReasoningSupportSchema.
// ═══════════════════════════════════════════════════════════════════════════════

const reasoningFormat = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    /** Endpoint-wide wire behavior, interpreted only in Main. */
    wire: ReasoningWireProfileSchema.optional()
  })

/** Provider reasoning format — discriminated union by format type. */
export const ProviderReasoningFormatSchema = z.discriminatedUnion('type', [
  reasoningFormat('openai-chat'),
  reasoningFormat('openai-responses'),
  reasoningFormat('anthropic'),
  reasoningFormat('gemini'),
  reasoningFormat('ollama'),
  reasoningFormat('none')
])

/** The discriminator values of {@link ProviderReasoningFormatSchema} — the ONE
 *  source of the format-type list (shared re-derives its zod enum from this). */
export type ReasoningFormatType = z.infer<typeof ProviderReasoningFormatSchema>['type']
export const REASONING_FORMAT_TYPES = ProviderReasoningFormatSchema.options.map(
  (option) => option.shape.type.value
) as [ReasoningFormatType, ...ReasoningFormatType[]]

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Config
// ═══════════════════════════════════════════════════════════════════════════════

export const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.url().optional(),
    docs: z.url().optional(),
    apiKey: z.url().optional(),
    models: z.url().optional()
  })
})

/** Per-endpoint-type configuration in registry */
export const RegistryEndpointConfigSchema = z.object({
  /** Base URL for this endpoint type's API */
  baseUrl: z.url().optional(),
  /** URLs for fetching available models via this endpoint type */
  modelsApiUrls: z
    .object({
      /** Default models listing endpoint */
      default: z.url().optional(),
      /** Embedding models listing endpoint (if separate from default) */
      embedding: z.url().optional(),
      /** Image models listing endpoint (if separate from default) */
      image: z.url().optional(),
      /** Reranker models listing endpoint (if separate from default) */
      reranker: z.url().optional()
    })
    .optional(),
  /** How this endpoint type expects reasoning parameters to be formatted */
  reasoningFormat: ProviderReasoningFormatSchema.optional(),
  /**
   * AI SDK adapter family that handles this endpoint. Aligns with the IDs
   * registered in `appProviderIds`. Resolvers should prefer this over
   * heuristic id/baseUrl inference when present.
   */
  adapterFamily: z.string().optional()
})

export const ProviderConfigSchema = z
  .object({
    /** Unique provider identifier */
    id: ProviderIdSchema,
    presetProviderId: ProviderIdSchema.optional(),
    /** Display name */
    name: z.string(),
    /** Provider description */
    description: z.string().optional(),
    /** Per-endpoint-type configuration (partial record — not all endpoint types need to be present) */
    endpointConfigs: z
      .record(
        z.string().refine((k): k is EndpointType => endpointTypeValues.includes(k), {
          message: `Invalid endpoint type key, must be one of: ${objectValues(ENDPOINT_TYPE).join(', ')}`
        }),
        RegistryEndpointConfigSchema
      )
      .optional(),
    /** Default endpoint type for chat requests — null for providers not bound by this (e.g. AWS, Vertex) */
    defaultChatEndpoint: EndpointTypeSchema.nullable().default(null),
    /**
     * Where this provider's model list comes from. `'registry'` means it cannot
     * be enumerated over an API (login-based subscription providers); the shipped
     * registry catalog is returned by the model-list chokepoint instead. Defaults
     * to `'api'` (the provider exposes a `/models` endpoint).
     */
    modelListSource: z.enum(['api', 'registry']).default('api'),
    /**
     * Which credential kinds the provider accepts — the auth UIs to surface and
     * the runtime credential semantics. A *set*, because a provider can offer
     * more than one (CherryIN takes both a user API key and an app-managed OAuth
     * login). Members:
     * - `'api-key'` — user-entered key (the api-key/host inputs).
     * - `'oauth'` — app-managed OAuth session the app holds and refreshes.
     * - `'external-cli'` — credential lives in an external CLI's store and only
     *   works through that CLI's runtime (e.g. `claude-code`); drives env
     *   stripping and chat-picker hiding.
     *
     * Absent ⇒ the default `['api-key']`. "Login-based" (suppress the api-key
     * inputs) is the derived `!includes('api-key')`, not a value of its own.
     */
    authMethods: z.array(z.enum(['api-key', 'oauth', 'external-cli'])).optional(),
    /**
     * The provider serves requests without any credential — a local server
     * (ollama / lmstudio / gpustack / ovms) reachable over a baseUrl with no API
     * key or login. Drives the "no API key required" guards: model sync, painting
     * and OpenClaw gating skip the missing-key check. Distinct from login-based
     * (`authMethods` without `'api-key'`), which also suppresses the host UI — a
     * local provider still needs its baseUrl input. Defaults false.
     */
    authOptional: z.boolean().default(false),
    /** Provider-native (server-executed) built-in tools served by this host. */
    serverTools: z.array(ServerToolConfigSchema).default([]),
    /** API feature flags controlling request construction */
    apiFeatures: ApiFeaturesSchema.optional(),
    /**
     * Registry-owned currency for provider-reported costs whose wire payload
     * carries an amount but no currency. Absent means the amount stays
     * unpriced; consumers must not infer a default currency.
     */
    reportedCostCurrency: ZodCurrencySchema,
    /** Provider-owned Fast request transport. Effective support is declared per provider-model pair. */
    fastMode: z.object({ transport: FastModeTransportSchema }).optional(),
    /** Additional metadata including website URLs */
    metadata: MetadataSchema.and(ProviderWebsiteSchema)
  })
  .refine(
    (data) => {
      if (data.endpointConfigs && data.defaultChatEndpoint) {
        return data.defaultChatEndpoint in data.endpointConfigs
      }
      return true
    },
    {
      message: 'defaultChatEndpoint must exist as a key in endpointConfigs'
    }
  )

export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

export { ENDPOINT_TYPE } from './enums'
export type ApiFeatures = z.infer<typeof ApiFeaturesSchema>
export type ProviderReasoningFormat = z.infer<typeof ProviderReasoningFormatSchema>
export type RegistryEndpointConfig = z.infer<typeof RegistryEndpointConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
