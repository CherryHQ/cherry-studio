// NOTE: Types are defined inline in the schema for simplicity
// If needed, specific types can be imported from './apiModels'
import type { BodyForPath, ConcreteApiPaths, QueryParamsForPath, ResponseForPath } from './apiPaths'
import type { HttpMethod, PaginatedResponse, PaginationParams } from './apiTypes'

// Re-export for external use
export type { ConcreteApiPaths } from './apiPaths'

/**
 * Complete API Schema definitions for Test API
 *
 * Each path defines the supported HTTP methods with their:
 * - Request parameters (params, query, body)
 * - Response types
 * - Type safety guarantees
 *
 * This schema serves as the contract between renderer and main processes,
 * enabling full TypeScript type checking across IPC boundaries.
 */
export interface ApiSchemas {
  /**
   * App State storage endpoint
   * @example GET /app/state/tabs_state
   * @example PUT /app/state/tabs_state { "value": {...} }
   */
  '/app/state/:key': {
    /** Get app state by key */
    GET: {
      params: { key: string }
      response: any
    }
    /** Save app state */
    PUT: {
      params: { key: string }
      body: any
      response: { success: boolean }
    }
  }

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
      response: PaginatedResponse<any>
    }
    /** Create a new test item */
    POST: {
      body: {
        title: string
        description?: string
        type?: string
        status?: string
        priority?: string
        tags?: string[]
        metadata?: Record<string, any>
      }
      response: any
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
      response: any
    }
    /** Update a specific test item */
    PUT: {
      params: { id: string }
      body: {
        title?: string
        description?: string
        type?: string
        status?: string
        priority?: string
        tags?: string[]
        metadata?: Record<string, any>
      }
      response: any
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
      response: PaginatedResponse<any>
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
        data: any[]
      }
      response: {
        successful: number
        failed: number
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

/**
 * Simplified type extraction helpers
 */
export type ApiPaths = keyof ApiSchemas
export type ApiMethods<TPath extends ApiPaths> = keyof ApiSchemas[TPath] & HttpMethod
export type ApiResponse<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { response: infer R }
      ? R
      : never
    : never
  : never

export type ApiParams<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { params: infer P }
      ? P
      : never
    : never
  : never

export type ApiQuery<TPath extends ApiPaths, TMethod extends string> = TPath extends keyof ApiSchemas
  ? TMethod extends keyof ApiSchemas[TPath]
    ? ApiSchemas[TPath][TMethod] extends { query: infer Q }
      ? Q
      : never
    : never
  : never

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
