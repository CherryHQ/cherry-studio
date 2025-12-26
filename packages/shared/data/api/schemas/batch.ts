/**
 * Batch and Transaction API Schema definitions
 *
 * Contains cross-domain operations for batch processing and atomic transactions.
 * These endpoints are domain-agnostic and work with any API path.
 */

import type { HttpMethod } from '../apiTypes'

// ============================================================================
// Domain Models & DTOs
// ============================================================================

/**
 * Request for bulk operations on multiple items
 */
export interface BulkOperationRequest<TData = any> {
  /** Type of bulk operation to perform */
  operation: 'create' | 'update' | 'delete' | 'archive' | 'restore'
  /** Array of data items to process */
  data: TData[]
}

/**
 * Response from a bulk operation
 */
export interface BulkOperationResponse {
  /** Number of successfully processed items */
  successful: number
  /** Number of items that failed processing */
  failed: number
  /** Array of errors that occurred during processing */
  errors: Array<{
    /** Index of the item that failed */
    index: number
    /** Error message */
    error: string
    /** Optional additional error data */
    data?: any
  }>
}

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Batch and Transaction API Schema definitions
 *
 * Validation is performed at composition level via AssertValidSchemas
 * in schemas/index.ts, which ensures:
 * - All methods are valid HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * - All endpoints have a `response` field
 */
export interface BatchSchemas {
  /**
   * Batch execution of multiple requests
   * @example POST /batch { "requests": [...], "parallel": true }
   */
  '/batch': {
    /** Execute multiple API requests in a single call */
    POST: {
      body: {
        /** Array of requests to execute */
        requests: Array<{
          /** HTTP method for the request */
          method: HttpMethod
          /** API path for the request */
          path: string
          /** URL parameters */
          params?: any
          /** Request body */
          body?: any
        }>
        /** Execute requests in parallel vs sequential */
        parallel?: boolean
      }
      response: {
        /** Results array matching input order */
        results: Array<{
          /** HTTP status code */
          status: number
          /** Response data if successful */
          data?: any
          /** Error information if failed */
          error?: any
        }>
        /** Batch execution metadata */
        metadata: {
          /** Total execution duration in ms */
          duration: number
          /** Number of successful requests */
          successCount: number
          /** Number of failed requests */
          errorCount: number
        }
      }
    }
  }

  /**
   * Atomic transaction of multiple operations
   * @example POST /transaction { "operations": [...], "options": { "rollbackOnError": true } }
   */
  '/transaction': {
    /** Execute multiple operations in a database transaction */
    POST: {
      body: {
        /** Array of operations to execute atomically */
        operations: Array<{
          /** HTTP method for the operation */
          method: HttpMethod
          /** API path for the operation */
          path: string
          /** URL parameters */
          params?: any
          /** Request body */
          body?: any
        }>
        /** Transaction configuration options */
        options?: {
          /** Database isolation level */
          isolation?: 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'serializable'
          /** Rollback all operations on any error */
          rollbackOnError?: boolean
          /** Transaction timeout in milliseconds */
          timeout?: number
        }
      }
      response: Array<{
        /** HTTP status code */
        status: number
        /** Response data if successful */
        data?: any
        /** Error information if failed */
        error?: any
      }>
    }
  }
}
