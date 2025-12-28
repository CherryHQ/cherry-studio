/**
 * @fileoverview Centralized error handling for the Data API system
 *
 * This module provides comprehensive error management including:
 * - ErrorCode enum with HTTP status mapping
 * - Type-safe error details for each error type
 * - DataApiError class for structured error handling
 * - DataApiErrorFactory for convenient error creation
 * - Retryability configuration for automatic retry logic
 *
 * @example
 * ```typescript
 * import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api'
 *
 * // Create and throw an error
 * throw DataApiErrorFactory.notFound('Topic', 'abc123')
 *
 * // Check if error is retryable
 * if (error instanceof DataApiError && error.isRetryable) {
 *   await retry(operation)
 * }
 * ```
 */

import type { HttpMethod } from './apiTypes'

// ============================================================================
// Error Code Enum
// ============================================================================

/**
 * Standard error codes for the Data API system.
 * Maps to HTTP status codes via ERROR_STATUS_MAP.
 */
export enum ErrorCode {
  // ─────────────────────────────────────────────────────────────────
  // Client errors (4xx) - Issues with the request itself
  // ─────────────────────────────────────────────────────────────────

  /** 400 - Malformed request syntax or invalid parameters */
  BAD_REQUEST = 'BAD_REQUEST',

  /** 401 - Authentication required or credentials invalid */
  UNAUTHORIZED = 'UNAUTHORIZED',

  /** 404 - Requested resource does not exist */
  NOT_FOUND = 'NOT_FOUND',

  /** 405 - HTTP method not supported for this endpoint */
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',

  /** 422 - Request body fails validation rules */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /** 429 - Too many requests, retry after delay */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  /** 403 - Authenticated but lacks required permissions */
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // ─────────────────────────────────────────────────────────────────
  // Server errors (5xx) - Issues on the server side
  // ─────────────────────────────────────────────────────────────────

  /** 500 - Unexpected server error */
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',

  /** 500 - Database operation failed (connection, query, constraint) */
  DATABASE_ERROR = 'DATABASE_ERROR',

  /** 503 - Service temporarily unavailable, retry later */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  /** 504 - Request timed out waiting for response */
  TIMEOUT = 'TIMEOUT',

  // ─────────────────────────────────────────────────────────────────
  // Application-specific errors
  // ─────────────────────────────────────────────────────────────────

  /** 500 - Data migration process failed */
  MIGRATION_ERROR = 'MIGRATION_ERROR',

  /**
   * 423 - Resource is temporarily locked by another operation.
   * Use when: file being exported, data migration in progress,
   * or resource held by background process.
   * Retryable: Yes (resource may be released)
   */
  RESOURCE_LOCKED = 'RESOURCE_LOCKED',

  /**
   * 409 - Optimistic lock conflict, resource was modified after read.
   * Use when: multi-window editing same topic, version mismatch
   * on update, or stale data detected during save.
   * Client should: refresh data and retry or notify user.
   */
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',

  /**
   * 409 - Data integrity violation or inconsistent state detected.
   * Use when: referential integrity broken, computed values mismatch,
   * or data corruption found during validation.
   * Not retryable: requires investigation or data repair.
   */
  DATA_INCONSISTENT = 'DATA_INCONSISTENT'
}

// ============================================================================
// Error Code Mappings
// ============================================================================

/**
 * Maps error codes to HTTP status codes.
 * Used by DataApiError and DataApiErrorFactory.
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  // Client errors (4xx)
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PERMISSION_DENIED]: 403,

  // Server errors (5xx)
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.TIMEOUT]: 504,

  // Application-specific errors
  [ErrorCode.MIGRATION_ERROR]: 500,
  [ErrorCode.RESOURCE_LOCKED]: 423,
  [ErrorCode.CONCURRENT_MODIFICATION]: 409,
  [ErrorCode.DATA_INCONSISTENT]: 409
}

/**
 * Default error messages for each error code.
 * Used when no custom message is provided.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: 'Bad request: Invalid request format or parameters',
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized: Authentication required',
  [ErrorCode.NOT_FOUND]: 'Not found: Requested resource does not exist',
  [ErrorCode.METHOD_NOT_ALLOWED]: 'Method not allowed: HTTP method not supported for this endpoint',
  [ErrorCode.VALIDATION_ERROR]: 'Validation error: Request data does not meet requirements',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded: Too many requests',
  [ErrorCode.PERMISSION_DENIED]: 'Permission denied: Insufficient permissions for this operation',

  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error: An unexpected error occurred',
  [ErrorCode.DATABASE_ERROR]: 'Database error: Failed to access or modify data',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service unavailable: The service is temporarily unavailable',
  [ErrorCode.TIMEOUT]: 'Timeout: Request timed out waiting for response',

  [ErrorCode.MIGRATION_ERROR]: 'Migration error: Failed to migrate data',
  [ErrorCode.RESOURCE_LOCKED]: 'Resource locked: Resource is currently locked by another operation',
  [ErrorCode.CONCURRENT_MODIFICATION]: 'Concurrent modification: Resource was modified by another user',
  [ErrorCode.DATA_INCONSISTENT]: 'Data inconsistent: Data integrity violation detected'
}

// ============================================================================
// Request Context
// ============================================================================

/**
 * Request context attached to errors for debugging and logging.
 * Always transmitted via IPC for frontend display.
 */
export interface RequestContext {
  /** Unique identifier for request correlation */
  requestId: string
  /** API path that was called */
  path: string
  /** HTTP method used */
  method: HttpMethod
  /** Timestamp when request was initiated */
  timestamp?: number
}

// ============================================================================
// Error-specific Detail Types
// ============================================================================

/**
 * Details for VALIDATION_ERROR - field-level validation failures.
 * Maps field names to arrays of error messages.
 */
export interface ValidationErrorDetails {
  fieldErrors: Record<string, string[]>
}

/**
 * Details for NOT_FOUND - which resource was not found.
 */
export interface NotFoundErrorDetails {
  resource: string
  id?: string
}

/**
 * Details for DATABASE_ERROR - underlying database failure info.
 */
export interface DatabaseErrorDetails {
  originalError: string
  operation?: string
}

/**
 * Details for TIMEOUT - what operation timed out.
 */
export interface TimeoutErrorDetails {
  operation?: string
  timeoutMs?: number
}

/**
 * Details for DATA_INCONSISTENT - what data is inconsistent.
 */
export interface DataInconsistentErrorDetails {
  resource: string
  description?: string
}

/**
 * Details for PERMISSION_DENIED - what action was denied.
 */
export interface PermissionDeniedErrorDetails {
  action: string
  resource?: string
}

/**
 * Details for RESOURCE_LOCKED - which resource is locked.
 */
export interface ResourceLockedErrorDetails {
  resource: string
  id: string
  lockedBy?: string
}

/**
 * Details for CONCURRENT_MODIFICATION - which resource was concurrently modified.
 */
export interface ConcurrentModificationErrorDetails {
  resource: string
  id: string
}

/**
 * Details for INTERNAL_SERVER_ERROR - context about the failure.
 */
export interface InternalErrorDetails {
  originalError: string
  context?: string
}

// ============================================================================
// Type Mapping for Error Details
// ============================================================================

/**
 * Maps error codes to their specific detail types.
 * Only define for error codes that have structured details.
 */
export type ErrorDetailsMap = {
  [ErrorCode.VALIDATION_ERROR]: ValidationErrorDetails
  [ErrorCode.NOT_FOUND]: NotFoundErrorDetails
  [ErrorCode.DATABASE_ERROR]: DatabaseErrorDetails
  [ErrorCode.TIMEOUT]: TimeoutErrorDetails
  [ErrorCode.DATA_INCONSISTENT]: DataInconsistentErrorDetails
  [ErrorCode.PERMISSION_DENIED]: PermissionDeniedErrorDetails
  [ErrorCode.RESOURCE_LOCKED]: ResourceLockedErrorDetails
  [ErrorCode.CONCURRENT_MODIFICATION]: ConcurrentModificationErrorDetails
  [ErrorCode.INTERNAL_SERVER_ERROR]: InternalErrorDetails
}

/**
 * Get the detail type for a specific error code.
 * Falls back to generic Record for unmapped codes.
 */
export type DetailsForCode<T extends ErrorCode> = T extends keyof ErrorDetailsMap
  ? ErrorDetailsMap[T]
  : Record<string, unknown> | undefined

// ============================================================================
// Retryability Configuration
// ============================================================================

/**
 * Set of error codes that are safe to retry automatically.
 * These represent temporary failures that may succeed on retry.
 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.SERVICE_UNAVAILABLE, // 503 - Service temporarily down
  ErrorCode.TIMEOUT, // 504 - Request timed out
  ErrorCode.RATE_LIMIT_EXCEEDED, // 429 - Can retry after delay
  ErrorCode.DATABASE_ERROR, // 500 - Temporary DB issues
  ErrorCode.INTERNAL_SERVER_ERROR, // 500 - May be transient
  ErrorCode.RESOURCE_LOCKED // 423 - Lock may be released
])

/**
 * Check if an error code represents a retryable condition.
 * @param code - The error code to check
 * @returns true if the error is safe to retry
 */
export function isRetryableErrorCode(code: ErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code)
}

// ============================================================================
// Serialized Error Interface (for IPC transmission)
// ============================================================================

/**
 * Serialized error structure for IPC transmission.
 * Used in DataResponse.error field.
 * Note: Does not include stack trace - rely on Main process logs.
 */
export interface SerializedDataApiError {
  /** Error code from ErrorCode enum */
  code: ErrorCode | string
  /** Human-readable error message */
  message: string
  /** HTTP status code */
  status: number
  /** Structured error details */
  details?: Record<string, unknown>
  /** Request context for debugging */
  requestContext?: RequestContext
}

// ============================================================================
// DataApiError Class
// ============================================================================

/**
 * Custom error class for Data API errors.
 *
 * Provides type-safe error handling with:
 * - Typed error codes and details
 * - Retryability checking via `isRetryable` getter
 * - IPC serialization via `toJSON()` / `fromJSON()`
 * - Request context for debugging
 *
 * @example
 * ```typescript
 * // Throw a typed error
 * throw new DataApiError(
 *   ErrorCode.NOT_FOUND,
 *   'Topic not found',
 *   404,
 *   { resource: 'Topic', id: 'abc123' }
 * )
 *
 * // Check if error is retryable
 * if (error.isRetryable) {
 *   await retry(operation)
 * }
 * ```
 */
export class DataApiError<T extends ErrorCode = ErrorCode> extends Error {
  /** Error code from ErrorCode enum */
  public readonly code: T
  /** HTTP status code */
  public readonly status: number
  /** Structured error details (type depends on error code) */
  public readonly details?: DetailsForCode<T>
  /** Request context for debugging */
  public readonly requestContext?: RequestContext

  constructor(code: T, message: string, status: number, details?: DetailsForCode<T>, requestContext?: RequestContext) {
    super(message)
    this.name = 'DataApiError'
    this.code = code
    this.status = status
    this.details = details
    this.requestContext = requestContext

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataApiError)
    }
  }

  /**
   * Whether this error is safe to retry automatically.
   * Based on the RETRYABLE_ERROR_CODES configuration.
   */
  get isRetryable(): boolean {
    return isRetryableErrorCode(this.code)
  }

  /**
   * Whether this is a client error (4xx status).
   * Client errors typically indicate issues with the request itself.
   */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  /**
   * Whether this is a server error (5xx status).
   * Server errors typically indicate issues on the server side.
   */
  get isServerError(): boolean {
    return this.status >= 500 && this.status < 600
  }

  /**
   * Serialize for IPC transmission.
   * Note: Stack trace is NOT included - rely on Main process logs.
   * @returns Serialized error object for IPC
   */
  toJSON(): SerializedDataApiError {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details as Record<string, unknown> | undefined,
      requestContext: this.requestContext
    }
  }

  /**
   * Reconstruct DataApiError from IPC response.
   * @param error - Serialized error from IPC
   * @returns DataApiError instance
   */
  static fromJSON(error: SerializedDataApiError): DataApiError {
    return new DataApiError(error.code as ErrorCode, error.message, error.status, error.details, error.requestContext)
  }

  /**
   * Create DataApiError from a generic Error.
   * @param error - Original error
   * @param code - Error code to use (defaults to INTERNAL_SERVER_ERROR)
   * @param requestContext - Optional request context
   * @returns DataApiError instance
   */
  static fromError(
    error: Error,
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    requestContext?: RequestContext
  ): DataApiError {
    return new DataApiError(
      code,
      error.message,
      ERROR_STATUS_MAP[code],
      { originalError: error.message, context: error.name } as DetailsForCode<typeof code>,
      requestContext
    )
  }
}

// ============================================================================
// DataApiErrorFactory
// ============================================================================

/**
 * Factory for creating standardized DataApiError instances.
 * Provides convenience methods for common error types with proper typing.
 *
 * @example
 * ```typescript
 * // Create a not found error
 * throw DataApiErrorFactory.notFound('Topic', 'abc123')
 *
 * // Create a validation error
 * throw DataApiErrorFactory.validation({
 *   name: ['Name is required'],
 *   email: ['Invalid email format']
 * })
 * ```
 */
export class DataApiErrorFactory {
  /**
   * Create a DataApiError with any error code.
   * Use specialized methods when available for better type safety.
   * @param code - Error code from ErrorCode enum
   * @param customMessage - Optional custom error message
   * @param details - Optional structured error details
   * @param requestContext - Optional request context
   * @returns DataApiError instance
   */
  static create<T extends ErrorCode>(
    code: T,
    customMessage?: string,
    details?: DetailsForCode<T>,
    requestContext?: RequestContext
  ): DataApiError<T> {
    return new DataApiError(
      code,
      customMessage || ERROR_MESSAGES[code],
      ERROR_STATUS_MAP[code],
      details,
      requestContext
    )
  }

  /**
   * Create a validation error with field-specific error messages.
   * @param fieldErrors - Map of field names to error messages
   * @param message - Optional custom message
   * @param requestContext - Optional request context
   * @returns DataApiError with VALIDATION_ERROR code
   */
  static validation(
    fieldErrors: Record<string, string[]>,
    message?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.VALIDATION_ERROR> {
    return new DataApiError(
      ErrorCode.VALIDATION_ERROR,
      message || 'Request validation failed',
      ERROR_STATUS_MAP[ErrorCode.VALIDATION_ERROR],
      { fieldErrors },
      requestContext
    )
  }

  /**
   * Create a not found error for a specific resource.
   * @param resource - Resource type name (e.g., 'Topic', 'Message')
   * @param id - Optional resource identifier
   * @param requestContext - Optional request context
   * @returns DataApiError with NOT_FOUND code
   */
  static notFound(resource: string, id?: string, requestContext?: RequestContext): DataApiError<ErrorCode.NOT_FOUND> {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`
    return new DataApiError(
      ErrorCode.NOT_FOUND,
      message,
      ERROR_STATUS_MAP[ErrorCode.NOT_FOUND],
      { resource, id },
      requestContext
    )
  }

  /**
   * Create a database error from an original error.
   * @param originalError - The underlying database error
   * @param operation - Description of the failed operation
   * @param requestContext - Optional request context
   * @returns DataApiError with DATABASE_ERROR code
   */
  static database(
    originalError: Error,
    operation?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.DATABASE_ERROR> {
    return new DataApiError(
      ErrorCode.DATABASE_ERROR,
      `Database operation failed${operation ? `: ${operation}` : ''}`,
      ERROR_STATUS_MAP[ErrorCode.DATABASE_ERROR],
      { originalError: originalError.message, operation },
      requestContext
    )
  }

  /**
   * Create an internal server error from an unexpected error.
   * @param originalError - The underlying error
   * @param context - Additional context about where the error occurred
   * @param requestContext - Optional request context
   * @returns DataApiError with INTERNAL_SERVER_ERROR code
   */
  static internal(
    originalError: Error,
    context?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.INTERNAL_SERVER_ERROR> {
    const message = context
      ? `Internal error in ${context}: ${originalError.message}`
      : `Internal error: ${originalError.message}`
    return new DataApiError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      message,
      ERROR_STATUS_MAP[ErrorCode.INTERNAL_SERVER_ERROR],
      { originalError: originalError.message, context },
      requestContext
    )
  }

  /**
   * Create a permission denied error.
   * @param action - The action that was denied
   * @param resource - Optional resource that access was denied to
   * @param requestContext - Optional request context
   * @returns DataApiError with PERMISSION_DENIED code
   */
  static permissionDenied(
    action: string,
    resource?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.PERMISSION_DENIED> {
    const message = resource ? `Permission denied: Cannot ${action} ${resource}` : `Permission denied: Cannot ${action}`
    return new DataApiError(
      ErrorCode.PERMISSION_DENIED,
      message,
      ERROR_STATUS_MAP[ErrorCode.PERMISSION_DENIED],
      { action, resource },
      requestContext
    )
  }

  /**
   * Create a timeout error.
   * @param operation - Description of the operation that timed out
   * @param timeoutMs - The timeout duration in milliseconds
   * @param requestContext - Optional request context
   * @returns DataApiError with TIMEOUT code
   */
  static timeout(
    operation?: string,
    timeoutMs?: number,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.TIMEOUT> {
    const message = operation
      ? `Request timeout: ${operation}${timeoutMs ? ` (${timeoutMs}ms)` : ''}`
      : `Request timeout${timeoutMs ? ` (${timeoutMs}ms)` : ''}`
    return new DataApiError(
      ErrorCode.TIMEOUT,
      message,
      ERROR_STATUS_MAP[ErrorCode.TIMEOUT],
      { operation, timeoutMs },
      requestContext
    )
  }

  /**
   * Create a data inconsistency error.
   * @param resource - The resource with inconsistent data
   * @param description - Description of the inconsistency
   * @param requestContext - Optional request context
   * @returns DataApiError with DATA_INCONSISTENT code
   */
  static dataInconsistent(
    resource: string,
    description?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.DATA_INCONSISTENT> {
    const message = description
      ? `Data inconsistent in ${resource}: ${description}`
      : `Data inconsistent in ${resource}`
    return new DataApiError(
      ErrorCode.DATA_INCONSISTENT,
      message,
      ERROR_STATUS_MAP[ErrorCode.DATA_INCONSISTENT],
      { resource, description },
      requestContext
    )
  }

  /**
   * Create a resource locked error.
   * Use when a resource is temporarily unavailable due to:
   * - File being exported
   * - Data migration in progress
   * - Resource held by background process
   *
   * @param resource - Resource type name
   * @param id - Resource identifier
   * @param lockedBy - Optional description of what's holding the lock
   * @param requestContext - Optional request context
   * @returns DataApiError with RESOURCE_LOCKED code
   */
  static resourceLocked(
    resource: string,
    id: string,
    lockedBy?: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.RESOURCE_LOCKED> {
    const message = lockedBy
      ? `${resource} '${id}' is locked by ${lockedBy}`
      : `${resource} '${id}' is currently locked`
    return new DataApiError(
      ErrorCode.RESOURCE_LOCKED,
      message,
      ERROR_STATUS_MAP[ErrorCode.RESOURCE_LOCKED],
      { resource, id, lockedBy },
      requestContext
    )
  }

  /**
   * Create a concurrent modification error.
   * Use when an optimistic lock conflict occurs:
   * - Multi-window editing same topic
   * - Version mismatch on update
   * - Stale data detected during save
   *
   * Client should refresh data and retry or notify user.
   *
   * @param resource - Resource type name
   * @param id - Resource identifier
   * @param requestContext - Optional request context
   * @returns DataApiError with CONCURRENT_MODIFICATION code
   */
  static concurrentModification(
    resource: string,
    id: string,
    requestContext?: RequestContext
  ): DataApiError<ErrorCode.CONCURRENT_MODIFICATION> {
    return new DataApiError(
      ErrorCode.CONCURRENT_MODIFICATION,
      `${resource} '${id}' was modified by another user`,
      ERROR_STATUS_MAP[ErrorCode.CONCURRENT_MODIFICATION],
      { resource, id },
      requestContext
    )
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an error is a DataApiError instance.
 * @param error - Any error object
 * @returns true if the error is a DataApiError
 */
export function isDataApiError(error: unknown): error is DataApiError {
  return error instanceof DataApiError
}

/**
 * Check if an object is a serialized DataApiError.
 * @param error - Any object
 * @returns true if the object has DataApiError structure
 */
export function isSerializedDataApiError(error: unknown): error is SerializedDataApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'status' in error &&
    typeof (error as SerializedDataApiError).code === 'string' &&
    typeof (error as SerializedDataApiError).message === 'string' &&
    typeof (error as SerializedDataApiError).status === 'number'
  )
}

/**
 * Convert any error to a DataApiError.
 * If already a DataApiError, returns as-is.
 * Otherwise, wraps in an INTERNAL_SERVER_ERROR.
 *
 * @param error - Any error
 * @param context - Optional context description
 * @returns DataApiError instance
 */
export function toDataApiError(error: unknown, context?: string): DataApiError {
  if (isDataApiError(error)) {
    return error
  }

  if (isSerializedDataApiError(error)) {
    return DataApiError.fromJSON(error)
  }

  if (error instanceof Error) {
    return DataApiErrorFactory.internal(error, context)
  }

  return DataApiErrorFactory.create(
    ErrorCode.INTERNAL_SERVER_ERROR,
    `Unknown error${context ? ` in ${context}` : ''}: ${String(error)}`,
    { originalError: String(error), context } as DetailsForCode<ErrorCode.INTERNAL_SERVER_ERROR>
  )
}
