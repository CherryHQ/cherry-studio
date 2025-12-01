/**
 * Zod v4 schemas for comprehensive runtime type validation
 * Replaces manual validation with strict type-safe schemas
 */

//TODO: 从catalog导入

import * as z from 'zod'

// Base parameter schemas
const ParameterRangeSchema = z.object({
  supported: z.literal(true),
  min: z.number().positive(),
  max: z.number().positive(),
  default: z.number().positive()
})

const ParameterBooleanSchema = z.object({
  supported: z.boolean()
})

const ParameterUnsupportedSchema = z.object({
  supported: z.literal(false)
})

const ParameterValueSchema = z.union([ParameterRangeSchema, ParameterBooleanSchema, ParameterUnsupportedSchema])

// Model parameters schema
const ModelParametersSchema = z
  .object({
    temperature: ParameterValueSchema.optional(),
    max_tokens: z.union([
      z.boolean(), // Simple boolean support indicator
      z.object({
        supported: z.literal(true),
        default: z.number().positive().optional()
      })
    ]).optional(),
    system_message: z.boolean().optional(), // Simple boolean support indicator
    top_p: z.union([ParameterValueSchema, ParameterUnsupportedSchema]).optional()
  })
  .loose() // Allow additional parameter types

// Pricing schema
const PricingInfoSchema = z.object({
  input: z.object({
    per_million_tokens: z.number().nonnegative(),
    currency: z.string().length(3) // ISO 4217 currency codes
  }),
  output: z.object({
    per_million_tokens: z.number().nonnegative(),
    currency: z.string().length(3)
  })
})

// Model metadata schema
const ModelMetadataSchema = z
  .object({
    source: z.string().optional(),
    original_provider: z.string().optional(),
    supports_caching: z.boolean().optional()
  })
  .loose() // Allow additional metadata

// Complete Model schema
export const ModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  owned_by: z.string().optional(),
  capabilities: z.array(z.string()),
  input_modalities: z.array(z.string()),
  output_modalities: z.array(z.string()),
  context_window: z.number().positive(),
  max_output_tokens: z.number().positive(),
  max_input_tokens: z.number().positive().optional(),
  pricing: PricingInfoSchema.optional(),
  parameters: ModelParametersSchema.optional(),
  endpoint_types: z.array(z.string()).optional(),
  metadata: ModelMetadataSchema.optional()
})

// Provider behaviors schema
const ProviderBehaviorsSchema = z
  .object({
    supports_custom_models: z.boolean(),
    provides_model_mapping: z.boolean(),
    supports_model_versioning: z.boolean(),
    provides_fallback_routing: z.boolean(),
    has_auto_retry: z.boolean(),
    supports_health_check: z.boolean(),
    has_real_time_metrics: z.boolean(),
    provides_usage_analytics: z.boolean(),
    supports_webhook_events: z.boolean(),
    requires_api_key_validation: z.boolean(),
    supports_rate_limiting: z.boolean(),
    provides_usage_limits: z.boolean(),
    supports_streaming: z.boolean(),
    supports_batch_processing: z.boolean(),
    supports_model_fine_tuning: z.boolean()
  })
  .loose() // Allow extensions

// API compatibility schema
const ApiCompatibilitySchema = z
  .object({
    supports_array_content: z.boolean().optional(),
    supports_stream_options: z.boolean().optional(),
    supports_developer_role: z.boolean().optional(),
    supports_service_tier: z.boolean().optional(),
    supports_thinking_control: z.boolean().optional(),
    supports_api_version: z.boolean().optional(),
    supports_parallel_tools: z.boolean().optional(),
    supports_multimodal: z.boolean().optional()
  })
  .loose()

// Special configuration schema (flexible)
const SpecialConfigSchema = z.record(z.string(), z.unknown())

// Provider metadata schema
const ProviderMetadataSchema = z
  .object({
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reliability: z.enum(['low', 'medium', 'high']).optional()
  })
  .loose()

// Complete Provider schema
export const ProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  authentication: z.string().min(1),
  pricing_model: z.string().min(1),
  model_routing: z.string().min(1),
  behaviors: ProviderBehaviorsSchema,
  supported_endpoints: z.array(z.string()),
  api_compatibility: ApiCompatibilitySchema.optional(),
  default_api_host: z.url().optional(),
  default_rate_limit: z.number().positive().optional(),
  model_id_patterns: z.array(z.string()).optional(),
  alias_model_ids: z.record(z.string(), z.string()).optional(),
  documentation: z.string().url().optional(),
  website: z.string().url().optional(),
  deprecated: z.boolean(),
  maintenance_mode: z.boolean(),
  config_version: z.string().min(1),
  special_config: SpecialConfigSchema.optional(),
  metadata: ProviderMetadataSchema.optional()
})

// Data file schemas
export const ModelsDataFileSchema = z.object({
  version: z.string().min(1),
  models: z.array(ModelSchema)
})

export const ProvidersDataFileSchema = z.object({
  version: z.string().min(1),
  providers: z.array(ProviderSchema)
})

// Override schemas
const OverrideLimitsSchema = z.object({
  context_window: z.number().positive().optional(),
  max_output_tokens: z.number().positive().optional()
})

export const ProviderModelOverrideSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  disabled: z.boolean().default(false),
  reason: z.string().optional(),
  last_updated: z.string().optional(),
  updated_by: z.string().optional(),
  priority: z.number().default(100),
  limits: OverrideLimitsSchema.optional(),
  pricing: PricingInfoSchema.optional()
})

export const OverridesDataFileSchema = z.object({
  version: z.string().min(1),
  overrides: z.array(ProviderModelOverrideSchema)
})

// Pagination schemas
export const PaginationInfoSchema = z.object({
  page: z.number().positive(),
  limit: z.number().positive().max(100),
  total: z.number().nonnegative(),
  totalPages: z.number().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean()
})

export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: PaginationInfoSchema
  })

// Query parameter schemas
export const QueryParamsSchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
  search: z.string().trim().optional(),
  capabilities: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional(),
  authentication: z.array(z.string()).optional()
})

// Request schemas for API endpoints
export const ModelListRequestSchema = QueryParamsSchema.extend({
  capabilities: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional()
})

export const ProviderListRequestSchema = QueryParamsSchema.extend({
  authentication: z.array(z.string()).optional()
})

// Response schemas
export const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional()
})

export const SuccessResponseSchema = z.object({
  success: z.literal(true)
})

export const ModelUpdateResponseSchema = SuccessResponseSchema.extend({
  model: ModelSchema
})

export const ProviderUpdateResponseSchema = SuccessResponseSchema.extend({
  provider: ProviderSchema
})

// Utility types for strict typing
export const CapabilityTypeSchema = z.enum([
  'FUNCTION_CALL',
  'REASONING',
  'IMAGE_RECOGNITION',
  'IMAGE_GENERATION',
  'AUDIO_RECOGNITION',
  'AUDIO_GENERATION',
  'EMBEDDING',
  'RERANK',
  'AUDIO_TRANSCRIPT',
  'VIDEO_RECOGNITION',
  'VIDEO_GENERATION',
  'STRUCTURED_OUTPUT',
  'FILE_INPUT',
  'WEB_SEARCH',
  'CODE_EXECUTION',
  'FILE_SEARCH',
  'COMPUTER_USE'
])

export const ModalityTypeSchema = z.enum(['TEXT', 'VISION', 'AUDIO', 'VIDEO'])

export const AuthenticationTypeSchema = z.enum(['API_KEY', 'OAUTH', 'NONE', 'CUSTOM'])

export const EndpointTypeSchema = z.enum(['CHAT_COMPLETIONS', 'MESSAGES', 'RESPONSES', 'EMBEDDINGS', 'RERANK'])

// Validation utilities using Zod

// Custom error class for Zod validation errors
export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: unknown,
    public zodError?: z.ZodError
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// String validation function
export function validateString(value: string, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string`)
  }
  return value.trim()
}

// Safe JSON parsing with Zod validation
export async function safeParseWithValidation<T>(
  jsonString: string,
  schema: z.ZodType<T>,
  errorMessage: string
): Promise<T> {
  try {
    const parsed = JSON.parse(jsonString)
    const result = schema.safeParse(parsed)

    if (!result.success) {
      throw new ValidationError(`${errorMessage}: ${result.error.message}`, result.error.issues, result.error)
    }

    return result.data
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError('Invalid JSON format', { originalError: error.message })
    }
    if (error instanceof ValidationError) {
      throw error
    }
    throw new ValidationError(
      `Unexpected error during validation: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

// Validate API response structure using Zod
export function validatePaginatedResponse<T>(
  data: unknown,
  itemSchema: z.ZodType<T>
): z.infer<ReturnType<typeof PaginatedResponseSchema<typeof itemSchema>>> {
  const schema = PaginatedResponseSchema(itemSchema)
  const result = schema.safeParse(data)

  if (!result.success) {
    throw new ValidationError(`Invalid response format: ${result.error.message}`, result.error.issues, result.error)
  }

  return result.data
}

// Validate and sanitize query parameters using Zod
export function validateQueryParams(params: URLSearchParams): z.infer<typeof QueryParamsSchema> {
  const queryParams: Record<string, string | string[]> = {}

  // Handle all parameters - Array.from() for compatibility
  Array.from(params.entries()).forEach(([key, value]) => {
    if (['capabilities', 'providers', 'authentication'].includes(key)) {
      if (!queryParams[key]) {
        queryParams[key] = []
      }
      ;(queryParams[key] as string[]).push(value)
    } else {
      queryParams[key] = value
    }
  })

  const result = QueryParamsSchema.safeParse(queryParams)

  if (!result.success) {
    throw new ValidationError(`Invalid query parameters: ${result.error.message}`, result.error.issues, result.error)
  }

  return result.data
}

// Type-safe error response creation
export function createErrorResponse(
  message: string,
  status: number = 500,
  details?: unknown
): z.infer<typeof ApiErrorSchema> {
  const error: z.infer<typeof ApiErrorSchema> = { error: message }
  if (details !== undefined) {
    ;(error as any).details = details
  }
  return error
}

// Safe type casting utility using Zod
export function safeTypeCast<T>(value: unknown, schema: z.ZodType<T>, typeName?: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(
      `Expected ${typeName || schema.description || 'valid type'}, but validation failed: ${result.error.message}`,
      result.error.issues,
      result.error
    )
  }
  return result.data
}

// Utility function to extract validation error details
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return `${path ? `${path}: ` : ''}${issue.message}`
    })
    .join('; ')
}

// Export inferred types
export type Model = z.infer<typeof ModelSchema>
export type Provider = z.infer<typeof ProviderSchema>
export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>
export type ModelsDataFile = z.infer<typeof ModelsDataFileSchema>
export type ProvidersDataFile = z.infer<typeof ProvidersDataFileSchema>
export type OverridesDataFile = z.infer<typeof OverridesDataFileSchema>
export type PaginationInfo = z.infer<typeof PaginationInfoSchema>
export type PaginatedResponse<T> = z.infer<ReturnType<typeof PaginatedResponseSchema<z.ZodType<T>>>>
export type ModelListRequest = z.infer<typeof ModelListRequestSchema>
export type ProviderListRequest = z.infer<typeof ProviderListRequestSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>
export type ModelUpdateResponse = z.infer<typeof ModelUpdateResponseSchema>
export type ProviderUpdateResponse = z.infer<typeof ProviderUpdateResponseSchema>

// Export enum types for convenience
export type CapabilityType = z.infer<typeof CapabilityTypeSchema>
export type ModalityType = z.infer<typeof ModalityTypeSchema>
export type AuthenticationType = z.infer<typeof AuthenticationTypeSchema>
export type EndpointType = z.infer<typeof EndpointTypeSchema>

// Legacy compatibility type guards (now using Zod internally)
export function isModel(obj: unknown): obj is Model {
  return ModelSchema.safeParse(obj).success
}

export function isProvider(obj: unknown): obj is Provider {
  return ProviderSchema.safeParse(obj).success
}

export function isModelsDataFile(obj: unknown): obj is ModelsDataFile {
  return ModelsDataFileSchema.safeParse(obj).success
}

export function isProvidersDataFile(obj: unknown): obj is ProvidersDataFile {
  return ProvidersDataFileSchema.safeParse(obj).success
}
