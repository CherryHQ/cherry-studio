/**
 * Generic test model definitions
 * Contains flexible types for comprehensive API testing
 */

/**
 * Generic test item entity - flexible structure for testing various scenarios
 */
export interface TestItem {
  /** Unique identifier */
  id: string
  /** Item title */
  title: string
  /** Optional description */
  description?: string
  /** Type category */
  type: string
  /** Current status */
  status: string
  /** Priority level */
  priority: string
  /** Associated tags */
  tags: string[]
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
  /** Additional metadata */
  metadata: Record<string, any>
}

/**
 * Data Transfer Objects (DTOs) for test operations
 */

/**
 * DTO for creating a new test item
 */
export interface CreateTestItemDto {
  /** Item title */
  title: string
  /** Optional description */
  description?: string
  /** Type category */
  type?: string
  /** Current status */
  status?: string
  /** Priority level */
  priority?: string
  /** Associated tags */
  tags?: string[]
  /** Additional metadata */
  metadata?: Record<string, any>
}

/**
 * DTO for updating an existing test item
 */
export interface UpdateTestItemDto {
  /** Updated title */
  title?: string
  /** Updated description */
  description?: string
  /** Updated type */
  type?: string
  /** Updated status */
  status?: string
  /** Updated priority */
  priority?: string
  /** Updated tags */
  tags?: string[]
  /** Updated metadata */
  metadata?: Record<string, any>
}

/**
 * Bulk operation types for batch processing
 */

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
