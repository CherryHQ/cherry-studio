/**
 * Centralized error code definitions for the Data API system
 * Provides consistent error handling across renderer and main processes
 */

import type { DataApiError } from './apiTypes'
import { ErrorCode } from './apiTypes'

// Re-export ErrorCode for convenience
export { ErrorCode } from './apiTypes'

/**
 * Error code to HTTP status mapping
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  // Client errors (4xx)
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,

  // Server errors (5xx)
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,

  // Custom application errors (5xx)
  [ErrorCode.MIGRATION_ERROR]: 500,
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.RESOURCE_LOCKED]: 423,
  [ErrorCode.CONCURRENT_MODIFICATION]: 409
}

/**
 * Default error messages for each error code
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: 'Bad request: Invalid request format or parameters',
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized: Authentication required',
  [ErrorCode.FORBIDDEN]: 'Forbidden: Insufficient permissions',
  [ErrorCode.NOT_FOUND]: 'Not found: Requested resource does not exist',
  [ErrorCode.METHOD_NOT_ALLOWED]: 'Method not allowed: HTTP method not supported for this endpoint',
  [ErrorCode.VALIDATION_ERROR]: 'Validation error: Request data does not meet requirements',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded: Too many requests',

  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error: An unexpected error occurred',
  [ErrorCode.DATABASE_ERROR]: 'Database error: Failed to access or modify data',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service unavailable: The service is temporarily unavailable',

  [ErrorCode.MIGRATION_ERROR]: 'Migration error: Failed to migrate data',
  [ErrorCode.PERMISSION_DENIED]: 'Permission denied: Operation not allowed for current user',
  [ErrorCode.RESOURCE_LOCKED]: 'Resource locked: Resource is currently locked by another operation',
  [ErrorCode.CONCURRENT_MODIFICATION]: 'Concurrent modification: Resource was modified by another user'
}

/**
 * Utility class for creating standardized Data API errors
 */
export class DataApiErrorFactory {
  /**
   * Create a DataApiError with standard properties
   */
  static create(code: ErrorCode, customMessage?: string, details?: any, stack?: string): DataApiError {
    return {
      code,
      message: customMessage || ERROR_MESSAGES[code],
      status: ERROR_STATUS_MAP[code],
      details,
      stack: stack || undefined
    }
  }

  /**
   * Create a validation error with field-specific details
   */
  static validation(fieldErrors: Record<string, string[]>, message?: string): DataApiError {
    return this.create(ErrorCode.VALIDATION_ERROR, message || 'Request validation failed', { fieldErrors })
  }

  /**
   * Create a not found error for specific resource
   */
  static notFound(resource: string, id?: string): DataApiError {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`

    return this.create(ErrorCode.NOT_FOUND, message, { resource, id })
  }

  /**
   * Create a database error with query details
   */
  static database(originalError: Error, operation?: string): DataApiError {
    return this.create(
      ErrorCode.DATABASE_ERROR,
      `Database operation failed${operation ? `: ${operation}` : ''}`,
      {
        originalError: originalError.message,
        operation
      },
      originalError.stack
    )
  }

  /**
   * Create a permission denied error
   */
  static permissionDenied(action: string, resource?: string): DataApiError {
    const message = resource ? `Permission denied: Cannot ${action} ${resource}` : `Permission denied: Cannot ${action}`

    return this.create(ErrorCode.PERMISSION_DENIED, message, { action, resource })
  }

  /**
   * Create an internal server error from an unexpected error
   */
  static internal(originalError: Error, context?: string): DataApiError {
    const message = context
      ? `Internal error in ${context}: ${originalError.message}`
      : `Internal error: ${originalError.message}`

    return this.create(
      ErrorCode.INTERNAL_SERVER_ERROR,
      message,
      { originalError: originalError.message, context },
      originalError.stack
    )
  }

  /**
   * Create a rate limit exceeded error
   */
  static rateLimit(limit: number, windowMs: number): DataApiError {
    return this.create(ErrorCode.RATE_LIMIT_EXCEEDED, `Rate limit exceeded: ${limit} requests per ${windowMs}ms`, {
      limit,
      windowMs
    })
  }

  /**
   * Create a resource locked error
   */
  static resourceLocked(resource: string, id: string, lockedBy?: string): DataApiError {
    const message = lockedBy
      ? `${resource} '${id}' is locked by ${lockedBy}`
      : `${resource} '${id}' is currently locked`

    return this.create(ErrorCode.RESOURCE_LOCKED, message, { resource, id, lockedBy })
  }

  /**
   * Create a concurrent modification error
   */
  static concurrentModification(resource: string, id: string): DataApiError {
    return this.create(ErrorCode.CONCURRENT_MODIFICATION, `${resource} '${id}' was modified by another user`, {
      resource,
      id
    })
  }
}

/**
 * Check if an error is a Data API error
 */
export function isDataApiError(error: any): error is DataApiError {
  return (
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.status === 'number'
  )
}

/**
 * Convert a generic error to a DataApiError
 */
export function toDataApiError(error: unknown, context?: string): DataApiError {
  if (isDataApiError(error)) {
    return error
  }

  if (error instanceof Error) {
    return DataApiErrorFactory.internal(error, context)
  }

  return DataApiErrorFactory.create(
    ErrorCode.INTERNAL_SERVER_ERROR,
    `Unknown error${context ? ` in ${context}` : ''}: ${String(error)}`,
    { originalError: error, context }
  )
}
