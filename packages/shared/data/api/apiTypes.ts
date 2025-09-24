/**
 * Core types for the Data API system
 * Provides type definitions for request/response handling across renderer-main IPC communication
 */

/**
 * Standard HTTP methods supported by the Data API
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

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
    /** Cache options for this specific request */
    cache?: CacheOptions
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
  error?: DataApiError
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

/**
 * Standardized error structure for Data API
 */
export interface DataApiError {
  /** Error code for programmatic handling */
  code: string
  /** Human-readable error message */
  message: string
  /** HTTP status code */
  status: number
  /** Additional error details */
  details?: any
  /** Error stack trace (development mode only) */
  stack?: string
}

/**
 * Standard error codes for Data API
 */
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Server errors (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Custom application errors
  MIGRATION_ERROR = 'MIGRATION_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_LOCKED = 'RESOURCE_LOCKED',
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION'
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Cache TTL in seconds */
  ttl?: number
  /** Return stale data while revalidating in background */
  staleWhileRevalidate?: boolean
  /** Custom cache key override */
  cacheKey?: string
  /** Operations that should invalidate this cache entry */
  invalidateOn?: string[]
  /** Whether to bypass cache entirely */
  noCache?: boolean
}

/**
 * Transaction request wrapper for atomic operations
 */
export interface TransactionRequest {
  /** List of operations to execute in transaction */
  operations: DataRequest[]
  /** Transaction options */
  options?: {
    /** Database isolation level */
    isolation?: 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'serializable'
    /** Whether to rollback entire transaction on any error */
    rollbackOnError?: boolean
    /** Transaction timeout in milliseconds */
    timeout?: number
  }
}

/**
 * Batch request for multiple operations
 */
export interface BatchRequest {
  /** List of requests to execute */
  requests: DataRequest[]
  /** Whether to execute requests in parallel */
  parallel?: boolean
  /** Stop on first error */
  stopOnError?: boolean
}

/**
 * Batch response containing results for all requests
 */
export interface BatchResponse {
  /** Individual response for each request */
  results: DataResponse[]
  /** Overall batch execution metadata */
  metadata: {
    /** Total execution time */
    duration: number
    /** Number of successful operations */
    successCount: number
    /** Number of failed operations */
    errorCount: number
  }
}

/**
 * Pagination parameters for list operations
 */
export interface PaginationParams {
  /** Page number (1-based) */
  page?: number
  /** Items per page */
  limit?: number
  /** Cursor for cursor-based pagination */
  cursor?: string
  /** Sort field and direction */
  sort?: {
    field: string
    order: 'asc' | 'desc'
  }
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /** Items for current page */
  items: T[]
  /** Total number of items */
  total: number
  /** Current page number */
  page: number
  /** Total number of pages */
  pageCount: number
  /** Whether there are more pages */
  hasNext: boolean
  /** Whether there are previous pages */
  hasPrev: boolean
  /** Next cursor for cursor-based pagination */
  nextCursor?: string
  /** Previous cursor for cursor-based pagination */
  prevCursor?: string
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

/**
 * Standard service response wrapper
 */
export interface ServiceResult<T = any> {
  /** Whether operation was successful */
  success: boolean
  /** Result data if successful */
  data?: T
  /** Error information if failed */
  error?: DataApiError
  /** Additional metadata */
  metadata?: Record<string, any>
}
