/**
 * @fileoverview DataApiService - API client for data requests (Renderer Process)
 *
 * NAMING NOTE:
 * This component is named "DataApiService" for management consistency, but it is
 * actually an API client rather than a business service.
 *
 * True Nature: API Client / Gateway
 * - Provides HTTP-like interface for making data requests to Main process
 * - Wraps IPC communication with type-safe, retry-enabled interface
 * - Acts as a Gateway/Facade for all data operations from renderer
 * - Contains zero business logic - purely communication infrastructure
 *
 * Key Features:
 * - Type-safe requests with full TypeScript inference
 * - Automatic retry with exponential backoff (network, timeout, 500/503 errors)
 * - Request timeout management (3s default)
 * - Data change notification fan-out (cross-window convergence)
 *
 * Architecture:
 * React Component → DataApiService (this file) → IPC → Main Process
 * Main Process → Handlers → Services → DB → IPC Response
 * DataApiService → Updates component state
 *
 * The "Service" suffix is kept for consistency with existing codebase conventions,
 * but developers should understand this is an API client (similar to axios, fetch).
 *
 * @see {@link DataApiService} Main process coordinator
 * @see {@link useDataApi} React hook for data requests
 */

import { loggerService } from '@logger'
import type { RequestContext } from '@shared/data/api/errors'
import { DataApiError, DataApiErrorFactory, ErrorCode, toDataApiError } from '@shared/data/api/errors'
import type { BodyForPath, QueryParamsForPath, ResponseForPath } from '@shared/data/api/paths'
import type { ApiClient, ConcreteApiPaths, DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'
import type { DataRequest, DataResponse, HttpMethod } from '@shared/data/api/types'

import { DataApiDevtools } from './utils/dataApiDevtools'

const logger = loggerService.withContext('DataApiService')

/**
 * Retry options interface.
 * Retryability is now determined by DataApiError.isRetryable getter.
 */
interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial delay between retries in milliseconds */
  retryDelay: number
  /** Multiplier for exponential backoff */
  backoffMultiplier: number
}

/**
 * Strongly-typed HTTP client for Data API
 * Simplified version using SWR for caching and request management
 * Focuses on IPC communication between renderer and main process
 */
export class DataApiService implements ApiClient {
  private requestId = 0

  // Data change fan-out: endpoint → listeners. The ONLY state of the facility.
  private dataChangeListeners = new Map<GetMethodApiPaths, Set<(effects: DataApiDataChangeEffect[]) => void>>()

  // Default retry options
  // Retryability is determined by DataApiError.isRetryable
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 2,
    retryDelay: 1000,
    backoffMultiplier: 2
  }

  constructor() {
    // Attach the fixed data-change channel at construction: consumers reach
    // this singleton through the module import graph before any query mounts,
    // so the channel is structurally live first and the fan-out map stays the
    // facility's only state. Optional chaining: test environments may lack
    // the preload bridge — in production preload always runs before renderer
    // modules, so the bridge exists here and the listener is never detached
    // (window-lifetime singleton).
    window.api?.dataApi?.onDataChanged?.((effects) => this.dispatchDataChange(effects))
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestId}`
  }

  /**
   * Configure retry options
   * @param options Partial retry options to override defaults
   */
  configureRetry(options: Partial<RetryOptions>): void {
    this.defaultRetryOptions = {
      ...this.defaultRetryOptions,
      ...options
    }

    logger.debug('Retry options updated', this.defaultRetryOptions)
  }

  /**
   * Get current retry configuration
   */
  getRetryConfig(): RetryOptions {
    return { ...this.defaultRetryOptions }
  }

  /**
   * Send request via IPC with direct return and retry logic.
   * Uses DataApiError.isRetryable to determine if retry is appropriate.
   */
  private async sendRequest<T>(request: DataRequest, retryCount = 0): Promise<T> {
    if (!window.api.dataApi.request) {
      throw DataApiErrorFactory.create(ErrorCode.SERVICE_UNAVAILABLE, 'Data API not available')
    }
    let errorMetadata: DataResponse['metadata'] | undefined
    DataApiDevtools.recordStart({
      requestId: request.id,
      method: request.method,
      path: request.path,
      query: request.params,
      body: request.body,
      retryAttempt: retryCount
    })

    // Build request context for error tracking
    const requestContext: RequestContext = {
      requestId: request.id,
      path: request.path,
      method: request.method,
      timestamp: Date.now()
    }

    try {
      logger.debug(`Making ${request.method} request to ${request.path}`, { request })

      // Direct IPC call with timeout
      const response = await Promise.race([
        window.api.dataApi.request(request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(DataApiErrorFactory.timeout(request.path, 3000, requestContext)), 3000)
        )
      ])

      if (response.error) {
        // Reconstruct DataApiError from serialized response
        errorMetadata = response.metadata
        throw DataApiError.fromJSON(response.error)
      }

      DataApiDevtools.recordSuccess({
        requestId: request.id,
        method: request.method,
        path: request.path,
        response
      })

      logger.debug(`Request succeeded: ${request.method} ${request.path}`, {
        status: response.status,
        hasData: !!response.data
      })

      return response.data as T
    } catch (error) {
      // Ensure we have a DataApiError for consistent handling
      const apiError =
        error instanceof DataApiError ? error : toDataApiError(error, `${request.method} ${request.path}`)

      DataApiDevtools.recordError({
        requestId: request.id,
        method: request.method,
        path: request.path,
        error: apiError,
        status: apiError.status,
        metadata: errorMetadata
      })

      logger.debug(`Request failed: ${request.method} ${request.path}`, apiError)

      // Check if should retry using the error's built-in isRetryable getter
      if (retryCount < this.defaultRetryOptions.maxRetries && apiError.isRetryable) {
        DataApiDevtools.recordRetry({
          requestId: request.id,
          method: request.method,
          path: request.path,
          retryAttempt: retryCount + 1,
          error: apiError
        })

        logger.debug(
          `Retrying request attempt ${retryCount + 1}/${this.defaultRetryOptions.maxRetries}: ${request.path}`,
          { error: apiError.message, code: apiError.code }
        )

        // Calculate delay with exponential backoff
        const delay =
          this.defaultRetryOptions.retryDelay * Math.pow(this.defaultRetryOptions.backoffMultiplier, retryCount)

        await new Promise((resolve) => setTimeout(resolve, delay))

        // Create new request with new ID for retry
        const retryRequest = { ...request, id: this.generateRequestId() }
        return this.sendRequest<T>(retryRequest, retryCount + 1)
      }

      throw apiError
    }
  }

  /**
   * Make HTTP request with enhanced features
   */
  private async makeRequest<T>(
    method: HttpMethod,
    path: string,
    options: {
      params?: any
      body?: any
      headers?: Record<string, string>
      metadata?: Record<string, any>
    } = {}
  ): Promise<T> {
    const { params, body, headers, metadata } = options

    // Create request
    const request: DataRequest = {
      id: this.generateRequestId(),
      method,
      path,
      params,
      body,
      headers,
      metadata: {
        timestamp: Date.now(),
        ...metadata
      }
    }

    logger.debug(`Making ${method} request to ${path}`, { request })

    return this.sendRequest<T>(request).catch((error) => {
      logger.error(`Request failed: ${method} ${path}`, error)
      throw toDataApiError(error, `${method} ${path}`)
    })
  }

  /**
   * Type-safe GET request
   */
  async get<TPath extends ConcreteApiPaths>(
    path: TPath,
    options?: {
      query?: QueryParamsForPath<TPath, 'GET'>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'GET'>> {
    return this.makeRequest<ResponseForPath<TPath, 'GET'>>('GET', path as string, {
      params: options?.query,
      headers: options?.headers
    })
  }

  /**
   * Type-safe POST request
   */
  async post<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body?: BodyForPath<TPath, 'POST'>
      query?: QueryParamsForPath<TPath, 'POST'>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'POST'>> {
    return this.makeRequest<ResponseForPath<TPath, 'POST'>>('POST', path as string, {
      params: options.query,
      body: options.body,
      headers: options.headers
    })
  }

  /**
   * Type-safe PUT request
   */
  async put<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body: BodyForPath<TPath, 'PUT'>
      query?: QueryParamsForPath<TPath, 'PUT'>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'PUT'>> {
    return this.makeRequest<ResponseForPath<TPath, 'PUT'>>('PUT', path as string, {
      params: options.query,
      body: options.body,
      headers: options.headers
    })
  }

  /**
   * Type-safe DELETE request
   */
  async delete<TPath extends ConcreteApiPaths>(
    path: TPath,
    options?: {
      query?: QueryParamsForPath<TPath, 'DELETE'>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'DELETE'>> {
    return this.makeRequest<ResponseForPath<TPath, 'DELETE'>>('DELETE', path as string, {
      params: options?.query,
      headers: options?.headers
    })
  }

  /**
   * Type-safe PATCH request
   */
  async patch<TPath extends ConcreteApiPaths>(
    path: TPath,
    options: {
      body?: BodyForPath<TPath, 'PATCH'>
      query?: QueryParamsForPath<TPath, 'PATCH'>
      headers?: Record<string, string>
    }
  ): Promise<ResponseForPath<TPath, 'PATCH'>> {
    return this.makeRequest<ResponseForPath<TPath, 'PATCH'>>('PATCH', path as string, {
      params: options.query,
      body: options.body,
      headers: options.headers
    })
  }

  /**
   * Subscribe to DataApi data change notifications for one or more endpoints.
   *
   * The main process broadcasts a {@link DataApiDataChangeEffect} array after
   * each committed business write; this facility routes entries to listeners
   * by exact endpoint match. Everything below the endpoint is consumer policy:
   * matching `dimension` against the consumer's own effective sort profile or
   * constrained params, filtering by `entityIds`, choosing revalidate /
   * rebuild / ignore, and echo idempotency (the originating window receives
   * its own signals too).
   *
   * Batch semantics: within one notification, all entries hitting any of this
   * subscription's endpoints are merged into ONE callback (one business
   * operation = one convergence action). No aggregation across notifications.
   *
   * Delivery is best-effort to live, continuously subscribed renderers (FIFO
   * per window). Residual race (accepted product contract): changes committed
   * between a consumer's first GET and its subscription registration — and
   * during main-process bootstrap — are not signaled; recovery is the
   * endpoint's next change, a remount, or any fresh query.
   *
   * @param endpoints - Endpoint(s) to watch (GET template paths)
   * @param listener - Called with the matching entries of one notification
   * @returns Unsubscribe function
   */
  onDataChanged(
    endpoints: GetMethodApiPaths | GetMethodApiPaths[],
    listener: (effects: DataApiDataChangeEffect[]) => void
  ): () => void {
    // One unique wrapper per registration: registrations of the same listener
    // function stay independent (unsubscribing one never detaches the other),
    // and the endpoint snapshot below is decoupled from the caller's array.
    const registered = (effects: DataApiDataChangeEffect[]) => listener(effects)
    const endpointList = [...new Set(Array.isArray(endpoints) ? endpoints : [endpoints])]
    for (const endpoint of endpointList) {
      let listeners = this.dataChangeListeners.get(endpoint)
      if (!listeners) {
        listeners = new Set()
        this.dataChangeListeners.set(endpoint, listeners)
      }
      listeners.add(registered)
    }

    return () => {
      for (const endpoint of endpointList) {
        const listeners = this.dataChangeListeners.get(endpoint)
        if (!listeners) continue
        listeners.delete(registered)
        if (listeners.size === 0) {
          this.dataChangeListeners.delete(endpoint)
        }
      }
    }
  }

  /**
   * Route one notification to subscribers: exact endpoint match, all matching
   * entries merged into a single callback per listener, listener failures
   * isolated so one bad consumer cannot block the others.
   */
  private dispatchDataChange(effects: DataApiDataChangeEffect[]): void {
    const matched = new Map<(effects: DataApiDataChangeEffect[]) => void, DataApiDataChangeEffect[]>()
    for (const effect of effects) {
      const listeners = this.dataChangeListeners.get(effect.endpoint)
      if (!listeners) continue
      for (const listener of listeners) {
        let batch = matched.get(listener)
        if (!batch) {
          batch = []
          matched.set(listener, batch)
        }
        batch.push(effect)
      }
    }
    for (const [listener, batch] of matched) {
      try {
        listener(batch)
      } catch (error) {
        logger.error('data change listener failed', error as Error)
      }
    }
  }
}

// Export singleton instance
export const dataApiService = new DataApiService()
