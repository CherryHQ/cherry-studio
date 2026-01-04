/**
 * Core types for the Data API system
 * Provides type definitions for request/response handling across renderer-main IPC communication
 */

/**
 * Standard HTTP methods supported by the Data API
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

// ============================================================================
// Schema Constraint Types
// ============================================================================

/**
 * Constraint for a single endpoint method definition.
 * Requires `response` field, allows optional `params`, `query`, and `body`.
 */
export type EndpointMethodConstraint = {
  params?: Record<string, any>
  query?: Record<string, any>
  body?: any
  response: any // response is required
}

/**
 * Constraint for a single API path - only allows valid HTTP methods.
 */
export type EndpointConstraint = {
  [Method in HttpMethod]?: EndpointMethodConstraint
}

/**
 * Validates that a schema only contains valid HTTP methods.
 * Used in AssertValidSchemas for compile-time validation.
 */
type ValidateMethods<T> = {
  [Path in keyof T]: {
    [Method in keyof T[Path]]: Method extends HttpMethod ? T[Path][Method] : never
  }
}

/**
 * Validates that all endpoints have a `response` field.
 * Returns the original type if valid, or `never` if any endpoint lacks response.
 */
type ValidateResponses<T> = {
  [Path in keyof T]: {
    [Method in keyof T[Path]]: T[Path][Method] extends { response: any }
      ? T[Path][Method]
      : { error: `Endpoint ${Path & string}.${Method & string} is missing 'response' field` }
  }
}

/**
 * Validates that a schema conforms to expected structure:
 * 1. All methods must be valid HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * 2. All endpoints must have a `response` field
 *
 * This is applied at the composition level (schemas/index.ts) to catch
 * invalid schemas even if individual schema files don't use validation.
 *
 * @example
 * ```typescript
 * // In schemas/index.ts
 * export type ApiSchemas = AssertValidSchemas<TestSchemas & BatchSchemas>
 *
 * // Invalid method will cause error:
 * // Type 'never' is not assignable to type...
 * ```
 */
export type AssertValidSchemas<T> = ValidateMethods<T> & ValidateResponses<T> extends infer R
  ? { [K in keyof R]: R[K] }
  : never

// ============================================================================
// Core Request/Response Types
// ============================================================================

/**
 * Request object structure for Data API calls
 */
export interface DataRequest<T = any> {
  /** Unique request identifier for tracking and correlation */
  id: string
  /** HTTP method for the request */
  method: HttpMethod
  /** API path (e.g., '/topics', '/topics/123') */
  path: string
  /** URL parameters for the request */
  params?: Record<string, any>
  /** Request body data */
  body?: T
  /** Request headers */
  headers?: Record<string, string>
  /** Additional metadata for request processing */
  metadata?: {
    /** Request timestamp */
    timestamp: number
    /** OpenTelemetry span context for tracing */
    spanContext?: any
  }
}

/**
 * Response object structure for Data API calls
 */
export interface DataResponse<T = any> {
  /** Request ID that this response corresponds to */
  id: string
  /** HTTP status code */
  status: number
  /** Response data if successful */
  data?: T
  /** Error information if request failed */
  error?: SerializedDataApiError
  /** Response metadata */
  metadata?: {
    /** Request processing duration in milliseconds */
    duration: number
    /** Whether response was served from cache */
    cached?: boolean
    /** Cache TTL if applicable */
    cacheTtl?: number
    /** Response timestamp */
    timestamp: number
  }
}

// Note: Error types have been moved to apiErrors.ts
// Import from there: ErrorCode, DataApiError, SerializedDataApiError, DataApiErrorFactory
import type { SerializedDataApiError } from './apiErrors'

// Re-export for backwards compatibility in DataResponse
export type { SerializedDataApiError } from './apiErrors'

// ============================================================================
// Pagination Types
// ============================================================================

// ----- Request Parameters -----

/**
 * Offset-based pagination parameters (page + limit)
 */
export interface OffsetPaginationParams {
  /** Page number (1-based) */
  page?: number
  /** Items per page */
  limit?: number
}

/**
 * Cursor-based pagination parameters (cursor + limit)
 */
export interface CursorPaginationParams {
  /** Cursor for next page (undefined for first page) */
  cursor?: string
  /** Items per page */
  limit?: number
}

/**
 * Sort parameters (independent, combine as needed)
 */
export interface SortParams {
  /** Field to sort by */
  sortBy?: string
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}

/**
 * Search parameters (independent, combine as needed)
 */
export interface SearchParams {
  /** Search query string */
  search?: string
}

// ----- Response Types -----

/**
 * Offset-based pagination response
 */
export interface OffsetPaginationResponse<T> {
  /** Items for current page */
  items: T[]
  /** Total number of items */
  total: number
  /** Current page number (1-based) */
  page: number
}

/**
 * Cursor-based pagination response
 */
export interface CursorPaginationResponse<T> {
  /** Items for current page */
  items: T[]
  /** Next cursor (undefined means no more data) */
  nextCursor?: string
}

// ----- Type Utilities -----

/**
 * Infer pagination mode from response type
 */
export type InferPaginationMode<R> = R extends OffsetPaginationResponse<any>
  ? 'offset'
  : R extends CursorPaginationResponse<any>
    ? 'cursor'
    : never

/**
 * Infer item type from pagination response
 */
export type InferPaginationItem<R> = R extends OffsetPaginationResponse<infer T>
  ? T
  : R extends CursorPaginationResponse<infer T>
    ? T
    : never

/**
 * Union type for both pagination responses
 */
export type PaginationResponse<T> = OffsetPaginationResponse<T> | CursorPaginationResponse<T>

/**
 * Type guard: check if response is offset-based
 */
export function isOffsetPaginationResponse<T>(
  response: PaginationResponse<T>
): response is OffsetPaginationResponse<T> {
  return 'page' in response && 'total' in response
}

/**
 * Type guard: check if response is cursor-based
 */
export function isCursorPaginationResponse<T>(
  response: PaginationResponse<T>
): response is CursorPaginationResponse<T> {
  return !('page' in response)
}

/**
 * Subscription options for real-time data updates
 */
export interface SubscriptionOptions {
  /** Path pattern to subscribe to */
  path: string
  /** Filters to apply to subscription */
  filters?: Record<string, any>
  /** Whether to receive initial data */
  includeInitial?: boolean
  /** Custom subscription metadata */
  metadata?: Record<string, any>
}

/**
 * Subscription callback function
 */
export type SubscriptionCallback<T = any> = (data: T, event: SubscriptionEvent) => void

/**
 * Subscription event types
 */
export enum SubscriptionEvent {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
  INITIAL = 'initial',
  ERROR = 'error'
}

/**
 * Middleware interface
 */
export interface Middleware {
  /** Middleware name */
  name: string
  /** Execution priority (lower = earlier) */
  priority?: number
  /** Middleware execution function */
  execute(req: DataRequest, res: DataResponse, next: () => Promise<void>): Promise<void>
}

/**
 * Request context passed through middleware chain
 */
export interface RequestContext {
  /** Original request */
  request: DataRequest
  /** Response being built */
  response: DataResponse
  /** Path that matched this request */
  path?: string
  /** HTTP method */
  method?: HttpMethod
  /** Authenticated user (if any) */
  user?: any
  /** Additional context data */
  data: Map<string, any>
}

/**
 * Base options for service operations
 */
export interface ServiceOptions {
  /** Database transaction to use */
  transaction?: any
  /** User context for authorization */
  user?: any
  /** Additional service-specific options */
  metadata?: Record<string, any>
}

// ============================================================================
// API Schema Type Utilities
// ============================================================================

import type { BodyForPath, ConcreteApiPaths, QueryParamsForPath, ResponseForPath } from './apiPaths'
import type { ApiSchemas } from './schemas'

// Re-export for external use
export type { ConcreteApiPaths } from './apiPaths'
export type { ApiSchemas } from './schemas'

/**
 * All available API paths
 */
export type ApiPaths = keyof ApiSchemas

/**
 * Available HTTP methods for a specific path
 */
export type ApiMethods<TPath extends ApiPaths> = keyof ApiSchemas[TPath] & HttpMethod

/**
 * Response type for a specific path and method
 */
export type ApiResponse<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { response: infer R }
      ? R
      : never
    : never
  : never

/**
 * URL params type for a specific path and method
 */
export type ApiParams<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { params: infer P }
      ? P
      : never
    : never
  : never

/**
 * Query params type for a specific path and method
 */
export type ApiQuery<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { query: infer Q }
      ? Q
      : never
    : never
  : never

/**
 * Request body type for a specific path and method
 */
export type ApiBody<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { body: infer B }
      ? B
      : never
    : never
  : never

/**
 * Type-safe API client interface using concrete paths
 * Accepts actual paths like '/test/items/123' instead of '/test/items/:id'
 * Automatically infers query, body, and response types from ApiSchemas
 */
export interface ApiClient {
  get<TPath extends ConcreteApiPaths>(
    path: TPath,
    options?: {
      query?: QueryParamsForPath<TPath>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'GET'>>

  post<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body?: BodyForPath<TPath, 'POST'>
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'POST'>>

  put<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body: BodyForPath<TPath, 'PUT'>
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'PUT'>>

  delete<TPath extends ConcreteApiPaths>(
    path: TPath,
    options?: {
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'DELETE'>>

  patch<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body?: BodyForPath<TPath, 'PATCH'>
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'PATCH'>>
}

/**
 * Helper types to determine if parameters are required based on schema
 */
type HasRequiredQuery<Path extends ApiPaths, Method extends ApiMethods<Path>> = Path extends keyof ApiSchemas
  ? Method extends keyof ApiSchemas[Path]
    ? ApiSchemas[Path][Method] extends { query: any }
      ? true
      : false
    : false
  : false

type HasRequiredBody<Path extends ApiPaths, Method extends ApiMethods<Path>> = Path extends keyof ApiSchemas
  ? Method extends keyof ApiSchemas[Path]
    ? ApiSchemas[Path][Method] extends { body: any }
      ? true
      : false
    : false
  : false

type HasRequiredParams<Path extends ApiPaths, Method extends ApiMethods<Path>> = Path extends keyof ApiSchemas
  ? Method extends keyof ApiSchemas[Path]
    ? ApiSchemas[Path][Method] extends { params: any }
      ? true
      : false
    : false
  : false

/**
 * Handler function for a specific API endpoint
 * Provides type-safe parameter extraction based on ApiSchemas
 * Parameters are required or optional based on the schema definition
 */
export type ApiHandler<Path extends ApiPaths, Method extends ApiMethods<Path>> = (
  params: (HasRequiredParams<Path, Method> extends true
    ? { params: ApiParams<Path, Method> }
    : { params?: ApiParams<Path, Method> }) &
    (HasRequiredQuery<Path, Method> extends true
      ? { query: ApiQuery<Path, Method> }
      : { query?: ApiQuery<Path, Method> }) &
    (HasRequiredBody<Path, Method> extends true ? { body: ApiBody<Path, Method> } : { body?: ApiBody<Path, Method> })
) => Promise<ApiResponse<Path, Method>>

/**
 * Complete API implementation that must match ApiSchemas structure
 * TypeScript will error if any endpoint is missing - this ensures exhaustive coverage
 */
export type ApiImplementation = {
  [Path in ApiPaths]: {
    [Method in ApiMethods<Path>]: ApiHandler<Path, Method>
  }
}
