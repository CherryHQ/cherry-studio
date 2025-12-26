/**
 * Cherry Studio Data API - Barrel Exports
 *
 * Exports common infrastructure types for the Data API system.
 * Domain-specific DTOs should be imported directly from their schema files.
 *
 * @example
 * ```typescript
 * // Infrastructure types from barrel export
 * import { DataRequest, DataResponse, ErrorCode, ApiClient } from '@shared/data/api'
 *
 * // Domain DTOs from schema files directly
 * import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topic'
 * ```
 */

// ============================================================================
// Core Request/Response Types
// ============================================================================

export type {
  BatchRequest,
  BatchResponse,
  DataApiError,
  DataRequest,
  DataResponse,
  HttpMethod,
  PaginatedResponse,
  PaginationParams,
  TransactionRequest
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
// Error Handling
// ============================================================================

export { ErrorCode, SubscriptionEvent } from './apiTypes'
export {
  DataApiErrorFactory,
  ERROR_MESSAGES,
  ERROR_STATUS_MAP,
  isDataApiError,
  toDataApiError
} from './errorCodes'

// ============================================================================
// Subscription & Middleware (for advanced usage)
// ============================================================================

export type {
  Middleware,
  RequestContext,
  ServiceOptions,
  SubscriptionCallback,
  SubscriptionOptions
} from './apiTypes'
