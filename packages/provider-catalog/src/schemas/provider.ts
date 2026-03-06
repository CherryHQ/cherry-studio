/**
 * Provider configuration schema definitions
 * Defines the structure for provider connections and API configurations
 */

import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'
import { ENDPOINT_TYPE, objectValues } from './enums'

export const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))

/** API compatibility flags for provider-specific behaviors */
export const ApiCompatibilitySchema = z.object({
  /** Whether the provider supports array-formatted content in messages */
  arrayContent: z.boolean().optional(),
  /** Whether the provider supports stream_options for usage data */
  streamOptions: z.boolean().optional(),
  /** Whether the provider supports the 'developer' role (OpenAI-specific) */
  developerRole: z.boolean().optional(),
  /** Whether the provider supports service tier selection (OpenAI-specific) */
  serviceTier: z.boolean().optional(),
  /** Whether the provider supports verbosity settings (Gemini-specific) */
  verbosity: z.boolean().optional(),
  /** Whether the provider supports enable_thinking parameter */
  enableThinking: z.boolean().optional(),
  /** Whether the provider requires an API key for authentication */
  requiresApiKey: z.boolean().optional()
})

export const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.url().optional(),
    docs: z.url().optional(),
    apiKey: z.url().optional(),
    models: z.url().optional()
  })
})

export const ProviderConfigSchema = z
  .object({
    /** Unique provider identifier */
    id: ProviderIdSchema,
    /** Display name */
    name: z.string(),
    /** Provider description */
    description: z.string().optional(),
    /** Base URLs keyed by endpoint type */
    baseUrls: z.record(EndpointTypeSchema, z.url()).optional(),
    /** Default endpoint type for chat requests (must exist in baseUrls) */
    defaultChatEndpoint: EndpointTypeSchema.optional(),
    /** API compatibility flags for provider-specific behaviors */
    apiCompatibility: ApiCompatibilitySchema.optional(),
    /** URLs for fetching available models, separated by model category */
    modelsApiUrls: z
      .object({
        /** Default models listing endpoint */
        default: z.url().optional(),
        /** Embedding models listing endpoint (if separate from default) */
        embedding: z.url().optional(),
        /** Reranker models listing endpoint (if separate from default) */
        reranker: z.url().optional()
      })
      .optional(),
    /** Additional metadata including website URLs */
    metadata: MetadataSchema.and(ProviderWebsiteSchema)
  })
  .refine(
    (data) => {
      if (data.defaultChatEndpoint && data.baseUrls) {
        return data.defaultChatEndpoint in data.baseUrls
      }
      return true
    },
    {
      message: 'defaultChatEndpoint must exist as a key in baseUrls'
    }
  )

export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

export type { EndpointType } from './enums'
export { ENDPOINT_TYPE } from './enums'
export type ApiCompatibility = z.infer<typeof ApiCompatibilitySchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
