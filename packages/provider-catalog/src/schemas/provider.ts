/**
 * Provider configuration schema definitions
 * Defines the structure for provider connections and API configurations
 */

import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'
import { EndpointType } from './enums'

export const EndpointTypeSchema = z.enum(EndpointType)

export const ApiCompatibilitySchema = z.object({
  arrayContent: z.boolean().optional(),
  streamOptions: z.boolean().optional(),
  developerRole: z.boolean().optional(),
  serviceTier: z.boolean().optional(),
  verbosity: z.boolean().optional(),
  enableThinking: z.boolean().optional(),
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

export const ProviderConfigSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  description: z.string().optional(),
  baseUrls: z.record(EndpointTypeSchema, z.url()).optional(),
  defaultChatEndpoint: EndpointTypeSchema.optional(),
  apiCompatibility: ApiCompatibilitySchema.optional(),
  modelsApiUrls: z
    .object({
      default: z.url().optional(),
      embedding: z.url().optional(),
      reranker: z.url().optional()
    })
    .optional(),
  metadata: MetadataSchema.and(ProviderWebsiteSchema)
})

export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

export type { EndpointType } from './enums'
export type ApiCompatibility = z.infer<typeof ApiCompatibilitySchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
