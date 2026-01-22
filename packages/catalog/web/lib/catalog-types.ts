/**
 * Type definitions for catalog management system
 * Now using Zod inferred types for complete type safety
 *
 * This file serves as the main export point for all types and schemas.
 * Types are now inferred from Zod schemas to ensure compile-time and runtime consistency.
 */

// Import all types from Zod validation schemas
export type {
  // Response and error types
  ApiError,
  AuthenticationType,
  // Utility enum types
  CapabilityType,
  EndpointType,
  ModalityType,
  // Core data types (inferred from Zod schemas)
  Model,
  ModelListRequest,
  ModelsDataFile,
  ModelUpdateResponse,
  OverridesDataFile,
  PaginatedResponse,
  // Pagination and response types
  PaginationInfo,
  Provider,
  ProviderListRequest,
  ProviderModelOverride,
  ProvidersDataFile,
  ProviderUpdateResponse,
  SuccessResponse
} from './validation'

// Import Zod schemas for direct use if needed
export {
  ApiErrorSchema,
  AuthenticationTypeSchema,
  // Utility schemas
  CapabilityTypeSchema,
  EndpointTypeSchema,
  ModalityTypeSchema,
  ModelListRequestSchema,
  // Core schemas
  ModelSchema,
  ModelsDataFileSchema,
  ModelUpdateResponseSchema,
  OverridesDataFileSchema,
  PaginatedResponseSchema,
  ProviderModelOverrideSchema,
  // Response schemas
  PaginationInfoSchema,
  ProviderListRequestSchema,
  ProviderSchema,
  ProvidersDataFileSchema,
  ProviderUpdateResponseSchema,
  QueryParamsSchema,
  SuccessResponseSchema
} from './validation'

// Import validation utilities for easy access
export {
  createErrorResponse,
  formatZodError,
  // Type guard functions (powered by Zod)
  isModel,
  isModelsDataFile,
  isProvider,
  isProvidersDataFile,
  safeParseWithValidation,
  safeTypeCast,
  validatePaginatedResponse,
  validateQueryParams,
  validateString,
  // Validation functions
  ValidationError
} from './validation'

// Legacy convenience types (for backward compatibility)
// These are now re-exports of the Zod-inferred types above
export type {
  // Re-export core types with legacy names for compatibility
  Model as CatalogModel,
  Provider as CatalogProvider,
  PaginatedResponse as CatalogResponse
} from './validation'
