import { loggerService } from '@logger'
import type { RequestContext as ErrorRequestContext } from '@shared/data/api/apiErrors'
import { DataApiError, DataApiErrorFactory, toDataApiError } from '@shared/data/api/apiErrors'
import type { ApiImplementation } from '@shared/data/api/apiTypes'
import type {
  DataRequest,
  DataResponse,
  HttpMethod,
  RequestContext,
  SuccessStatusCode
} from '@shared/data/api/apiTypes'
import { isCustomStatusResult, SuccessStatus } from '@shared/data/api/apiTypes'

import { MiddlewareEngine } from './MiddlewareEngine'

// Handler function type
type HandlerFunction = (params: { params?: Record<string, string>; query?: any; body?: any }) => Promise<any>

const logger = loggerService.withContext('DataApi:Server')

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

    // Build error request context for tracking
    const errorContext: ErrorRequestContext = {
      requestId: request.id,
      path,
      method: method,
      timestamp: startTime
    }

    logger.debug(`Processing request: ${method} ${path}`)

    try {
      // Find handler
      const handlerMatch = this.findHandler(path, method)

      if (!handlerMatch) {
        throw DataApiErrorFactory.notFound('Handler', `${method} ${path}`, errorContext)
      }

      // Create request context
      const requestContext = this.createRequestContext(request, path, method)

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

      // Convert to DataApiError and serialize for IPC
      const apiError = error instanceof DataApiError ? error : toDataApiError(error, `${method} ${path}`)

      return {
        id: request.id,
        status: apiError.status,
        error: apiError.toJSON(), // Serialize for IPC transmission
        metadata: {
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
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

  // Extract path parameters from URL.
  //
  // Supports two param forms:
  //   - Plain: `:name` matches exactly one path segment.
  //   - Greedy: `:name` + `*` (trailing star) matches one-or-more consecutive
  //     path segments, joined with `/`. Greedy may appear as the last segment,
  //     OR in the middle anchored by static / plain-param trailing segments.
  //     A pattern may contain at most one greedy param; a second greedy is
  //     rejected defensively to keep matching unambiguous. Greedy does NOT
  //     match zero segments.
  //
  // NOTE: Intentionally NOT calling decodeURIComponent() anywhere in this
  // function, including for greedy captures. Path params (IDs) in this project
  // are raw strings — keeping them untouched acts as implicit validation and
  // preserves embedded `/`, `::`, `%`, etc. verbatim. See also the docs at
  // docs/references/data/api-design-guidelines.md § "Greedy Tail Parameters".
  private extractPathParams(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/')
    const pathParts = path.split('/')

    const isGreedy = (part: string) => part.startsWith(':') && part.endsWith('*') && part.length > 2

    // Locate the greedy segment (if any) and reject patterns with more than one.
    let greedyIdx = -1
    for (let i = 0; i < patternParts.length; i++) {
      if (isGreedy(patternParts[i])) {
        if (greedyIdx !== -1) return null
        greedyIdx = i
      }
    }

    // Fast path: no greedy → strict length + classic matching.
    if (greedyIdx === -1) {
      if (patternParts.length !== pathParts.length) return null
      const params: Record<string, string> = {}
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
          params[patternParts[i].slice(1)] = pathParts[i]
        } else if (patternParts[i] !== pathParts[i]) {
          return null
        }
      }
      return params
    }

    // Greedy path: anchor leading + trailing static/plain segments, capture
    // the middle. Greedy captures at least one segment, so path length must
    // be >= pattern length.
    if (pathParts.length < patternParts.length) return null

    const trailingLen = patternParts.length - greedyIdx - 1
    const greedyEnd = pathParts.length - trailingLen // exclusive
    const params: Record<string, string> = {}

    // Match leading fixed part.
    for (let i = 0; i < greedyIdx; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i]
      } else if (patternParts[i] !== pathParts[i]) {
        return null
      }
    }

    // Match trailing fixed part (anchors the greedy capture).
    for (let t = 0; t < trailingLen; t++) {
      const patternPart = patternParts[greedyIdx + 1 + t]
      const pathPart = pathParts[greedyEnd + t]
      if (patternPart.startsWith(':')) {
        params[patternPart.slice(1)] = pathPart
      } else if (patternPart !== pathPart) {
        return null
      }
    }

    // Greedy capture (guaranteed ≥1 segment by the length check above).
    const greedyName = patternParts[greedyIdx].slice(1, -1)
    params[greedyName] = pathParts.slice(greedyIdx, greedyEnd).join('/')

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

      // Check if result is custom status format { data, status }
      if (isCustomStatusResult(result)) {
        response.data = result.data
        response.status = result.status
      } else {
        // Set response data
        if (result !== undefined) {
          response.data = result
        }
        // Infer status code based on HTTP method
        response.status = this.inferStatusCode(context.method!, result)
      }
    } catch (error) {
      logger.error('Handler execution failed', error as Error)
      throw error
    }
  }

  /**
   * Infer status code based on HTTP method and result
   */
  private inferStatusCode(method: HttpMethod, result: unknown): SuccessStatusCode {
    switch (method) {
      case 'POST':
        return SuccessStatus.CREATED // 201
      case 'DELETE':
        return result === undefined ? SuccessStatus.NO_CONTENT : SuccessStatus.OK // 204 or 200
      default:
        return SuccessStatus.OK // 200
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
