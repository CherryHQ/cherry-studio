import { loggerService } from '@logger'
import type { ApiImplementation } from '@shared/data/api/apiSchemas'
import type { DataRequest, DataResponse, HttpMethod, RequestContext } from '@shared/data/api/apiTypes'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errorCodes'

import { MiddlewareEngine } from './MiddlewareEngine'

// Handler function type
type HandlerFunction = (params: { params?: Record<string, string>; query?: any; body?: any }) => Promise<any>

const logger = loggerService.withContext('DataApiServer')

/**
 * Core API Server - Transport agnostic request processor
 * Now uses direct handler mapping for type-safe routing
 */
export class ApiServer {
  private static instance: ApiServer
  private middlewareEngine: MiddlewareEngine
  private handlers: ApiImplementation

  private constructor(handlers: ApiImplementation) {
    this.middlewareEngine = new MiddlewareEngine()
    this.handlers = handlers
  }

  /**
   * Initialize singleton instance with handlers
   */
  public static initialize(handlers: ApiImplementation): ApiServer {
    if (ApiServer.instance) {
      throw new Error('ApiServer already initialized')
    }
    ApiServer.instance = new ApiServer(handlers)
    return ApiServer.instance
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ApiServer {
    if (!ApiServer.instance) {
      throw new Error('ApiServer not initialized. Call initialize() first.')
    }
    return ApiServer.instance
  }

  /**
   * Register middleware
   */
  use(middleware: any): void {
    this.middlewareEngine.use(middleware)
  }

  /**
   * Main request handler - direct handler lookup
   */
  async handleRequest(request: DataRequest): Promise<DataResponse> {
    const { method, path } = request
    const startTime = Date.now()

    logger.debug(`Processing request: ${method} ${path}`)

    try {
      // Find handler
      const handlerMatch = this.findHandler(path, method as HttpMethod)

      if (!handlerMatch) {
        throw DataApiErrorFactory.create(ErrorCode.NOT_FOUND, `Handler not found: ${method} ${path}`)
      }

      // Create request context
      const requestContext = this.createRequestContext(request, path, method as HttpMethod)

      // Execute middleware chain
      await this.middlewareEngine.executeMiddlewares(requestContext)

      // Execute handler if middleware didn't set error
      if (!requestContext.response.error) {
        await this.executeHandler(requestContext, handlerMatch)
      }

      // Set timing metadata
      requestContext.response.metadata = {
        ...requestContext.response.metadata,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      }

      return requestContext.response
    } catch (error) {
      logger.error(`Request handling failed: ${method} ${path}`, error as Error)

      const apiError = DataApiErrorFactory.create(ErrorCode.INTERNAL_SERVER_ERROR, (error as Error).message)

      return {
        id: request.id,
        status: apiError.status,
        error: apiError,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      }
    }
  }

  /**
   * Handle batch requests
   */
  async handleBatchRequest(batchRequest: DataRequest): Promise<DataResponse> {
    const requests = batchRequest.body?.requests || []

    if (!Array.isArray(requests)) {
      throw DataApiErrorFactory.create(ErrorCode.VALIDATION_ERROR, 'Batch request body must contain requests array')
    }

    logger.debug(`Processing batch request with ${requests.length} requests`)

    // Use the batch handler from our handlers
    const batchHandler = this.handlers['/batch']?.POST
    if (!batchHandler) {
      throw DataApiErrorFactory.create(ErrorCode.NOT_FOUND, 'Batch handler not found')
    }

    const result = await batchHandler({ body: batchRequest.body })

    return {
      id: batchRequest.id,
      status: 200,
      data: result,
      metadata: {
        duration: 0,
        timestamp: Date.now()
      }
    }
  }

  /**
   * Find handler for given path and method
   */
  private findHandler(
    path: string,
    method: HttpMethod
  ): { handler: HandlerFunction; params: Record<string, string> } | null {
    // Direct lookup first
    const directHandler = (this.handlers as any)[path]?.[method]
    if (directHandler) {
      return { handler: directHandler, params: {} }
    }

    // Pattern matching for parameterized paths
    for (const [pattern, methods] of Object.entries(this.handlers)) {
      if (pattern.includes(':') && (methods as any)[method]) {
        const params = this.extractPathParams(pattern, path)
        if (params !== null) {
          return { handler: (methods as any)[method], params }
        }
      }
    }

    return null
  }

  /**
   * Extract path parameters from URL
   */
  private extractPathParams(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/')
    const pathParts = path.split('/')

    if (patternParts.length !== pathParts.length) {
      return null
    }

    const params: Record<string, string> = {}

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        const paramName = patternParts[i].slice(1)
        params[paramName] = pathParts[i]
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }

    return params
  }

  /**
   * Create request context
   */
  private createRequestContext(request: DataRequest, path: string, method: HttpMethod): RequestContext {
    const response: DataResponse = {
      id: request.id,
      status: 200
    }

    return {
      request,
      response,
      path,
      method,
      data: new Map()
    }
  }

  /**
   * Execute handler function
   */
  private async executeHandler(
    context: RequestContext,
    handlerMatch: { handler: HandlerFunction; params: Record<string, string> }
  ): Promise<void> {
    const { request, response } = context
    const { handler, params } = handlerMatch

    try {
      // Prepare handler parameters
      const handlerParams = {
        params,
        query: request.params, // URL query parameters
        body: request.body
      }

      // Execute handler
      const result = await handler(handlerParams)

      // Set response data
      if (result !== undefined) {
        response.data = result
      }

      if (!response.status) {
        response.status = 200
      }
    } catch (error) {
      logger.error('Handler execution failed', error as Error)
      throw error
    }
  }

  /**
   * Get system information
   */
  getSystemInfo() {
    const handlerPaths = Object.keys(this.handlers)
    const handlerCount = handlerPaths.reduce((count, path) => {
      return count + Object.keys((this.handlers as any)[path]).length
    }, 0)

    const middlewares = this.middlewareEngine.getMiddlewares()

    return {
      server: 'DataApiServer',
      version: '2.0',
      handlers: {
        paths: handlerPaths,
        total: handlerCount
      },
      middlewares: middlewares
    }
  }
}
