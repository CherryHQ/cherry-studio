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
      supports_url_pass_through: z.boolean().default(false),
      supported_servers: z.array(z.string()).optional(),
      max_concurrent_servers: z.number().optional()
    })
    .optional()
})

// API compatibility configuration
export const ApiCompatibilitySchema = z.object({
  supports_array_content: z.boolean().default(true),
  supports_stream_options: z.boolean().default(true),
  supports_developer_role: z.boolean().default(false),
  supports_service_tier: z.boolean().default(false),
  supports_thinking_control: z.boolean().default(false),
  supports_api_version: z.boolean().default(false),
  supports_parallel_tools: z.boolean().default(false),
  supports_multimodal: z.boolean().default(false),
  max_file_upload_size: z.number().optional(), // bytes
  supported_file_types: z.array(z.string()).optional()
})

// Behavior characteristics configuration - replaces categorization, describes actual behavior
export const ProviderBehaviorsSchema = z.object({
  // Model management
  supports_custom_models: z.boolean().default(false), // Supports user custom models
  provides_model_mapping: z.boolean().default(false), // Provides model name mapping
  supports_model_versioning: z.boolean().default(false), // Supports model version control

  // Reliability and fault tolerance
  provides_fallback_routing: z.boolean().default(false), // Provides fallback routing
  has_auto_retry: z.boolean().default(false), // Has automatic retry mechanism
  supports_health_check: z.boolean().default(false), // Supports health checks

  // Monitoring and metrics
  has_real_time_metrics: z.boolean().default(false), // Has real-time metrics
  provides_usage_analytics: z.boolean().default(false), // Provides usage analytics
  supports_webhook_events: z.boolean().default(false), // Supports webhook events

  // Configuration and management
  requires_api_key_validation: z.boolean().default(true), // Requires API key validation
  supports_rate_limiting: z.boolean().default(false), // Supports rate limiting
  provides_usage_limits: z.boolean().default(false), // Provides usage limit configuration

  // Advanced features
  supports_streaming: z.boolean().default(true), // Supports streaming responses
  supports_batch_processing: z.boolean().default(false), // Supports batch processing
  supports_model_fine_tuning: z.boolean().default(false) // Provides model fine-tuning
})

// Provider configuration schema
export const ProviderConfigSchema = z.object({
  // Basic information
  id: ProviderIdSchema,
  name: z.string(),
  description: z.string().optional(),

  // Behavior-related configuration
  authentication: AuthenticationSchema,
  pricing_model: PricingModelSchema,
  model_routing: ModelRoutingSchema,
  behaviors: ProviderBehaviorsSchema,

  // Feature support
  supported_endpoints: z
    .array(EndpointTypeSchema)
    .min(1, 'At least one endpoint must be supported')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Supported endpoints must be unique'
    }),
  mcp_support: McpSupportSchema.optional(),
  api_compatibility: ApiCompatibilitySchema.optional(),

  // Default configuration
  default_api_host: z.string().optional(),
  default_rate_limit: z.number().optional(), // requests per minute

  // Model matching assistance
  model_id_patterns: z.array(z.string()).optional(),
  alias_model_ids: z.record(z.string(), z.string()).optional(), // Model alias mapping

  // Special configuration
  special_config: MetadataSchema,

  // Metadata and links
  documentation: z.string().url().optional(),
  status_page: z.string().url().optional(),
  pricing_page: z.string().url().optional(),
  support_email: z.string().email().optional(),
  website: z.string().url().optional(),

  // Status management
  deprecated: z.boolean().default(false),
  deprecation_date: z.iso.datetime().optional(),
  maintenance_mode: z.boolean().default(false),

  // Version and compatibility
  min_app_version: VersionSchema.optional(), // Minimum supported app version
  max_app_version: VersionSchema.optional(), // Maximum supported app version
  config_version: VersionSchema.default('1.0.0'), // Configuration file version

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
