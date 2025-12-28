/**
 * Cherry Studio Data API - Barrel Exports
 *
 * Exports common infrastructure types for the Data API system.
 * Domain-specific DTOs should be imported directly from their schema files.
 *
 * @example
 * ```typescript
 * // Infrastructure types from barrel export
 * import { DataRequest, DataResponse, ErrorCode, DataApiError } from '@shared/data/api'
 *
 * // Domain DTOs from schema files directly
 * import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topic'
 * ```
 */

// ============================================================================
// Core Request/Response Types
// ============================================================================

export type {
  DataRequest,
  DataResponse,
  HttpMethod,
  PaginatedResponse,
  PaginationParams
} from './apiTypes'

// ============================================================================
// API Schema Type Utilities
// ============================================================================

export type {
  ApiBody,
  ApiClient,
  ApiHandler,
  ApiImplementation,
  ApiMethods,
  ApiParams,
  ApiPaths,
  ApiQuery,
  ApiResponse,
  ApiSchemas,
  ConcreteApiPaths
} from './apiTypes'

// ============================================================================
// Path Resolution Utilities
// ============================================================================

export type {
  BodyForPath,
  MatchApiPath,
  QueryParamsForPath,
  ResolvedPath,
  ResponseForPath
} from './apiPaths'

// ============================================================================
// Error Handling (from apiErrors.ts)
// ============================================================================

// Error code enum and mappings
export {
  ERROR_MESSAGES,
  ERROR_STATUS_MAP,
  ErrorCode,
  isRetryableErrorCode,
  RETRYABLE_ERROR_CODES
} from './apiErrors'

// DataApiError class and factory
export {
  DataApiError,
  DataApiErrorFactory,
  isDataApiError,
  isSerializedDataApiError,
  toDataApiError
} from './apiErrors'

// Error-related types
export type {
  ConcurrentModificationErrorDetails,
  DatabaseErrorDetails,
  DataInconsistentErrorDetails,
  DetailsForCode,
  ErrorDetailsMap,
  InternalErrorDetails,
  NotFoundErrorDetails,
  PermissionDeniedErrorDetails,
  RequestContext,
  ResourceLockedErrorDetails,
  SerializedDataApiError,
  TimeoutErrorDetails,
  ValidationErrorDetails
} from './apiErrors'

// ============================================================================
// Subscription & Middleware (for advanced usage)
// ============================================================================

export type { Middleware, ServiceOptions, SubscriptionCallback, SubscriptionOptions } from './apiTypes'
export { SubscriptionEvent } from './apiTypes'
