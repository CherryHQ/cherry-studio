import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'

// Authentication methods
export const AuthenticationSchema = z.enum([
  'API_KEY', // Standard API Key authentication
  'OAUTH', // OAuth 2.0 authentication
  'CLOUD_CREDENTIALS' // Cloud service credentials (AWS, GCP, Azure)
])

// Endpoint types - represents the API functionality
export const EndpointTypeSchema = z.enum([
  // LLM endpoints
  'CHAT_COMPLETIONS', // OpenAI chat completions
  'TEXT_COMPLETIONS', // OpenAI text completions
  'MESSAGES', // Anthropic messages API
  'RESPONSES', // OpenAI responses API (new format with reasoning)
  'GENERATE_CONTENT', // Gemini generateContent API

  // Embedding endpoints
  'EMBEDDINGS',
  'RERANK',

  // Image endpoints
  'IMAGE_GENERATION',
  'IMAGE_EDIT',
  'IMAGE_VARIATION',

  // Audio endpoints
  'AUDIO_TRANSCRIPTION',
  'AUDIO_TRANSLATION',
  'TEXT_TO_SPEECH',

  // Video endpoints
  'VIDEO_GENERATION'
])

// API format types - represents the protocol/format of the API
export const ApiFormatSchema = z.enum([
  'OPENAI', // OpenAI standard format (covers chat, embeddings, images, etc.)
  'ANTHROPIC', // Anthropic format
  'GEMINI', // Google Gemini API format
  'CUSTOM' // Custom/proprietary format
])

// Format configuration - maps API format to base URL
export const FormatConfigSchema = z.object({
  format: ApiFormatSchema,
  base_url: z.string().url(),
  default: z.boolean().default(false)
})

export const ApiCompatibilitySchema = z.object({
  supports_array_content: z.boolean().default(true),
  supports_stream_options: z.boolean().default(true),
  supports_developer_role: z.boolean().default(true),
  supports_service_tier: z.boolean().default(false),
  supports_thinking_control: z.boolean().default(true),
  supports_api_version: z.boolean().default(true)
})

// Models API endpoint configuration
export const ModelsApiEndpointSchema = z.object({
  // API endpoint URL
  url: z.string().url(),
  // Endpoint type (CHAT_COMPLETIONS, EMBEDDINGS, etc.)
  endpoint_type: EndpointTypeSchema,
  // API format for this endpoint
  format: ApiFormatSchema,
  // Optional authentication override (if different from provider default)
  auth: z
    .object({
      header_name: z.string().optional(), // e.g., "Authorization", "X-API-Key"
      prefix: z.string().optional() // e.g., "Bearer ", "sk-"
    })
    .optional(),
  // Optional custom transformer name if not OpenAI-compatible
  transformer: z.string().optional() // e.g., "openrouter", "aihubmix", "custom"
})

// Models API configuration
export const ModelsApiConfigSchema = z.object({
  // List of endpoints (most providers have one, some have multiple)
  endpoints: z.array(ModelsApiEndpointSchema).min(1),
  // Enable/disable auto-sync for this provider
  enabled: z.boolean().default(true),
  // Last successful sync timestamp
  last_synced: z.string().optional()
})

// Provider configuration schema
export const ProviderConfigSchema = z.object({
  // Basic information
  id: ProviderIdSchema,
  name: z.string(),
  description: z.string().optional(),

  // Authentication
  authentication: AuthenticationSchema.default('API_KEY'),

  // API format configurations
  // Each provider can support multiple API formats (e.g., OpenAI + Anthropic)
  formats: z
    .array(FormatConfigSchema)
    .min(1)
    .refine((formats) => formats.filter((f) => f.default).length <= 1, {
      message: 'Only one format can be marked as default'
    }),

  // Supported endpoint types (optional, for documentation)
  supported_endpoints: z.array(EndpointTypeSchema).optional(),

  // API compatibility - 保留以支持在线更新
  api_compatibility: ApiCompatibilitySchema.optional(),

  // Documentation links
  documentation: z.string().url().optional(),
  website: z.string().url().optional(),

  // Status management
  deprecated: z.boolean().default(false),

  // Models API configuration (optional)
  models_api: ModelsApiConfigSchema.optional(),

  // Additional metadata (tags, etc.)
  metadata: MetadataSchema
})

// Provider list container schema for JSON files
export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

// Type exports
export type Authentication = z.infer<typeof AuthenticationSchema>
export type EndpointType = z.infer<typeof EndpointTypeSchema>
export type ApiFormat = z.infer<typeof ApiFormatSchema>
export type FormatConfig = z.infer<typeof FormatConfigSchema>
export type ApiCompatibility = z.infer<typeof ApiCompatibilitySchema>
export type ModelsApiEndpoint = z.infer<typeof ModelsApiEndpointSchema>
export type ModelsApiConfig = z.infer<typeof ModelsApiConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
