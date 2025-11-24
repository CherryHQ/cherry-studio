/**
 * Provider configuration schema definitions
 * Defines the structure for AI service provider metadata and capabilities
 */

import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'

// Endpoint types supported by providers
export const EndpointTypeSchema = z.enum([
  'CHAT_COMPLETIONS', // /chat/completions
  'COMPLETIONS', // /completions
  'EMBEDDINGS', // /embeddings
  'IMAGE_GENERATION', // /images/generations
  'IMAGE_EDIT', // /images/edits
  'AUDIO_SPEECH', // /audio/speech (TTS)
  'AUDIO_TRANSCRIPTIONS', // /audio/transcriptions (STT)
  'MESSAGES', // /messages
  'RESPONSES', // /responses
  'GENERATE_CONTENT', // :generateContent
  'STREAM_GENERATE_CONTENT', // :streamGenerateContent
  'RERANK', // /rerank
  'MODERATIONS' // /moderations
])

// Authentication methods
export const AuthenticationSchema = z.enum([
  'API_KEY', // Standard API Key authentication
  'OAUTH', // OAuth 2.0 authentication
  'CLOUD_CREDENTIALS' // Cloud service credentials (AWS, GCP, Azure)
])

// Pricing models that affect UI and behavior
export const PricingModelSchema = z.enum([
  'UNIFIED', // Unified pricing (like OpenRouter)
  'PER_MODEL', // Per-model independent pricing (like OpenAI official)
  'TRANSPARENT', // Transparent pricing (like New-API)
  'USAGE_BASED', // Dynamic usage-based pricing
  'SUBSCRIPTION' // Subscription-based pricing
])

// Model routing strategies affecting performance and reliability
export const ModelRoutingSchema = z.enum([
  'INTELLIGENT', // Intelligent routing, auto-select optimal instance
  'DIRECT', // Direct routing to specified model
  'LOAD_BALANCED', // Load balanced across multiple instances
  'GEO_ROUTED', // Geographic location routing
  'COST_OPTIMIZED' // Cost-optimized routing
])

// Server-side MCP support configuration
export const McpSupportSchema = z.object({
  supported: z.boolean().default(false),
  configuration: z
    .object({
      supportsUrlPassThrough: z.boolean().default(false),
      supportedServers: z.array(z.string()).optional(),
      maxConcurrentServers: z.number().optional()
    })
    .optional()
})

// API compatibility configuration
export const ApiCompatibilitySchema = z.object({
  supportsArrayContent: z.boolean().default(true),
  supportsStreamOptions: z.boolean().default(true),
  supportsDeveloperRole: z.boolean().default(false),
  supportsServiceTier: z.boolean().default(false),
  supportsThinkingControl: z.boolean().default(false),
  supportsApiVersion: z.boolean().default(false),
  supportsParallelTools: z.boolean().default(false),
  supportsMultimodal: z.boolean().default(false),
  maxFileUploadSize: z.number().optional(), // bytes
  supportedFileTypes: z.array(z.string()).optional()
})

// Behavior characteristics configuration - replaces categorization, describes actual behavior
export const ProviderBehaviorsSchema = z.object({
  // Model management
  supportsCustomModels: z.boolean().default(false), // Supports user custom models
  providesModelMapping: z.boolean().default(false), // Provides model name mapping
  supportsModelVersioning: z.boolean().default(false), // Supports model version control

  // Reliability and fault tolerance
  providesFallbackRouting: z.boolean().default(false), // Provides fallback routing
  hasAutoRetry: z.boolean().default(false), // Has automatic retry mechanism
  supportsHealthCheck: z.boolean().default(false), // Supports health checks

  // Monitoring and metrics
  hasRealTimeMetrics: z.boolean().default(false), // Has real-time metrics
  providesUsageAnalytics: z.boolean().default(false), // Provides usage analytics
  supportsWebhookEvents: z.boolean().default(false), // Supports webhook events

  // Configuration and management
  requiresApiKeyValidation: z.boolean().default(true), // Requires API key validation
  supportsRateLimiting: z.boolean().default(false), // Supports rate limiting
  providesUsageLimits: z.boolean().default(false), // Provides usage limit configuration

  // Advanced features
  supportsStreaming: z.boolean().default(true), // Supports streaming responses
  supportsBatchProcessing: z.boolean().default(false), // Supports batch processing
  supportsModelFineTuning: z.boolean().default(false) // Provides model fine-tuning
})

// Provider configuration schema
export const ProviderConfigSchema = z.object({
  // Basic information
  id: ProviderIdSchema,
  name: z.string(),
  description: z.string().optional(),

  // Behavior-related configuration
  authentication: AuthenticationSchema,
  pricingModel: PricingModelSchema,
  modelRouting: ModelRoutingSchema,
  behaviors: ProviderBehaviorsSchema,

  // Feature support
  supportedEndpoints: z.array(EndpointTypeSchema),
  mcpSupport: McpSupportSchema.optional(),
  apiCompatibility: ApiCompatibilitySchema.optional(),

  // Default configuration
  defaultApiHost: z.string().optional(),
  defaultRateLimit: z.number().optional(), // requests per minute

  // Model matching assistance
  modelIdPatterns: z.array(z.string()).optional(),
  aliasModelIds: z.record(z.string(), z.string()).optional(), // Model alias mapping

  // Special configuration
  specialConfig: MetadataSchema,

  // Metadata and links
  documentation: z.string().url().optional(),
  statusPage: z.string().url().optional(),
  pricingPage: z.string().url().optional(),
  supportEmail: z.string().email().optional(),
  website: z.string().url().optional(),

  // Status management
  deprecated: z.boolean().default(false),
  deprecationDate: z.iso.datetime().optional(),
  maintenanceMode: z.boolean().default(false),

  // Version and compatibility
  minAppVersion: VersionSchema.optional(), // Minimum supported app version
  maxAppVersion: VersionSchema.optional(), // Maximum supported app version
  configVersion: VersionSchema.default('1.0.0'), // Configuration file version

  // Additional metadata
  metadata: MetadataSchema
})

// Provider list container schema for JSON files
export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

// Type exports
export type EndpointType = z.infer<typeof EndpointTypeSchema>
export type Authentication = z.infer<typeof AuthenticationSchema>
export type PricingModel = z.infer<typeof PricingModelSchema>
export type ModelRouting = z.infer<typeof ModelRoutingSchema>
export type McpSupport = z.infer<typeof McpSupportSchema>
export type ApiCompatibility = z.infer<typeof ApiCompatibilitySchema>
export type ProviderBehaviors = z.infer<typeof ProviderBehaviorsSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
