/**
 * Zod v4 schemas for comprehensive runtime type validation
 * Replaces manual validation with strict type-safe schemas
 */

import * as z from 'zod'
// Import schemas from catalog package
import {
  ModelConfigSchema,
  ModelListSchema,
  OverrideListSchema,
  ProviderConfigSchema,
  ProviderListSchema,
  ProviderModelOverrideSchema as CatalogProviderModelOverrideSchema
} from '../../src/schemas'


// Complete Model schema - use from catalog package
export const ModelSchema = ModelConfigSchema

// Complete Provider schema - use from catalog package
export const ProviderSchema = ProviderConfigSchema

// Data file schemas - use from catalog package
export const ModelsDataFileSchema = ModelListSchema
export const ProvidersDataFileSchema = ProviderListSchema

// Override schemas - use from catalog package
export const ProviderModelOverrideSchema = CatalogProviderModelOverrideSchema
export const OverridesDataFileSchema = OverrideListSchema

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

export const EndpointTypeSchema = z.enum([
  // LLM endpoints
  'CHAT_COMPLETIONS',
  'TEXT_COMPLETIONS',
  'MESSAGES',
  'RESPONSES',
  'GENERATE_CONTENT',
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
  details?: unknown
): z.infer<typeof ApiErrorSchema> {
  const error: z.infer<typeof ApiErrorSchema> = { error: message }
  if (details !== undefined) {
    // Type assertion needed because ApiErrorSchema allows optional details field
    Object.assign(error, { details })
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
