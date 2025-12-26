/**
 * Test API Schema definitions
 *
 * Contains all test-related endpoints for development and testing purposes.
 * These endpoints demonstrate the API patterns and provide testing utilities.
 */

import type { PaginatedResponse, PaginationParams } from '../apiTypes'

// ============================================================================
// Domain Models & DTOs
// ============================================================================

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

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Test API Schema definitions
 *
 * Validation is performed at composition level via AssertValidSchemas
 * in schemas/index.ts, which ensures:
 * - All methods are valid HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * - All endpoints have a `response` field
 */
export interface TestSchemas {
  /**
   * Test items collection endpoint
   * @example GET /test/items?page=1&limit=10&search=hello
   * @example POST /test/items { "title": "New Test Item" }
   */
  '/test/items': {
    /** List all test items with optional filtering and pagination */
    GET: {
      query?: PaginationParams & {
        /** Search items by title or description */
        search?: string
        /** Filter by item type */
        type?: string
        /** Filter by status */
        status?: string
      }
      response: PaginatedResponse<TestItem>
    }
    /** Create a new test item */
    POST: {
      body: CreateTestItemDto
      response: TestItem
    }
  }

  /**
   * Individual test item endpoint
   * @example GET /test/items/123
   * @example PUT /test/items/123 { "title": "Updated Title" }
   * @example DELETE /test/items/123
   */
  '/test/items/:id': {
    /** Get a specific test item by ID */
    GET: {
      params: { id: string }
      response: TestItem
    }
    /** Update a specific test item */
    PUT: {
      params: { id: string }
      body: UpdateTestItemDto
      response: TestItem
    }
    /** Delete a specific test item */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Test search endpoint
   * @example GET /test/search?query=hello&page=1&limit=20
   */
  '/test/search': {
    /** Search test items */
    GET: {
      query: {
        /** Search query string */
        query: string
        /** Page number for pagination */
        page?: number
        /** Number of results per page */
        limit?: number
        /** Additional filters */
        type?: string
        status?: string
      }
      response: PaginatedResponse<TestItem>
    }
  }

  /**
   * Test statistics endpoint
   * @example GET /test/stats
   */
  '/test/stats': {
    /** Get comprehensive test statistics */
    GET: {
      response: {
        /** Total number of items */
        total: number
        /** Item count grouped by type */
        byType: Record<string, number>
        /** Item count grouped by status */
        byStatus: Record<string, number>
        /** Item count grouped by priority */
        byPriority: Record<string, number>
        /** Recent activity timeline */
        recentActivity: Array<{
          /** Date of activity */
          date: string
          /** Number of items on that date */
          count: number
        }>
      }
    }
  }

  /**
   * Test bulk operations endpoint
   * @example POST /test/bulk { "operation": "create", "data": [...] }
   */
  '/test/bulk': {
    /** Perform bulk operations on test items */
    POST: {
      body: {
        /** Operation type */
        operation: 'create' | 'update' | 'delete'
        /** Array of data items to process */
        data: Array<CreateTestItemDto | UpdateTestItemDto | string>
      }
      response: {
        /** Number of successfully processed items */
        successful: number
        /** Number of items that failed processing */
        failed: number
        /** Array of error messages */
        errors: string[]
      }
    }
  }

  /**
   * Test error simulation endpoint
   * @example POST /test/error { "errorType": "timeout" }
   */
  '/test/error': {
    /** Simulate various error scenarios for testing */
    POST: {
      body: {
        /** Type of error to simulate */
        errorType:
          | 'timeout'
          | 'network'
          | 'server'
          | 'notfound'
          | 'validation'
          | 'unauthorized'
          | 'ratelimit'
          | 'generic'
      }
      response: never
    }
  }

  /**
   * Test slow response endpoint
   * @example POST /test/slow { "delay": 2000 }
   */
  '/test/slow': {
    /** Test slow response for performance testing */
    POST: {
      body: {
        /** Delay in milliseconds */
        delay: number
      }
      response: {
        message: string
        delay: number
        timestamp: string
      }
    }
  }

  /**
   * Test data reset endpoint
   * @example POST /test/reset
   */
  '/test/reset': {
    /** Reset all test data to initial state */
    POST: {
      response: {
        message: string
        timestamp: string
      }
    }
  }

  /**
   * Test config endpoint
   * @example GET /test/config
   * @example PUT /test/config { "setting": "value" }
   */
  '/test/config': {
    /** Get test configuration */
    GET: {
      response: Record<string, any>
    }
    /** Update test configuration */
    PUT: {
      body: Record<string, any>
      response: Record<string, any>
    }
  }

  /**
   * Test status endpoint
   * @example GET /test/status
   */
  '/test/status': {
    /** Get system test status */
    GET: {
      response: {
        status: string
        timestamp: string
        version: string
        uptime: number
        environment: string
      }
    }
  }

  /**
   * Test performance endpoint
   * @example GET /test/performance
   */
  '/test/performance': {
    /** Get performance metrics */
    GET: {
      response: {
        requestsPerSecond: number
        averageLatency: number
        memoryUsage: number
        cpuUsage: number
        uptime: number
      }
    }
  }
}
