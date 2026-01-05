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
 * - Subscription management (real-time updates)
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
import type { RequestContext } from '@shared/data/api/apiErrors'
import { DataApiError, DataApiErrorFactory, ErrorCode, toDataApiError } from '@shared/data/api/apiErrors'
import type { ApiClient, ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type {
  DataRequest,
  HttpMethod,
  SubscriptionCallback,
  SubscriptionEvent,
  SubscriptionOptions
} from '@shared/data/api/apiTypes'

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
  private static instance: DataApiService
  private requestId = 0

  // Subscriptions
  private subscriptions = new Map<
    string,
    {
      callback: SubscriptionCallback
      options: SubscriptionOptions
    }
  >()

  // Default retry options
  // Retryability is determined by DataApiError.isRetryable
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 2,
    retryDelay: 1000,
    backoffMultiplier: 2
  }

  private constructor() {
    // Initialization completed
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DataApiService {
    if (!DataApiService.instance) {
      DataApiService.instance = new DataApiService()
    }
    return DataApiService.instance
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

    // Build request context for error tracking
    const requestContext: RequestContext = {
      requestId: request.id,
      path: request.path,
      method: request.method as HttpMethod,
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
        throw DataApiError.fromJSON(response.error)
      }

      logger.debug(`Request succeeded: ${request.method} ${request.path}`, {
        status: response.status,
        hasData: !!response.data
      })

      return response.data as T
    } catch (error) {
      // Ensure we have a DataApiError for consistent handling
      const apiError =
        error instanceof DataApiError ? error : toDataApiError(error, `${request.method} ${request.path}`)

      logger.debug(`Request failed: ${request.method} ${request.path}`, apiError)

      // Check if should retry using the error's built-in isRetryable getter
      if (retryCount < this.defaultRetryOptions.maxRetries && apiError.isRetryable) {
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
      query?: any
      headers?: Record<string, string>
    }
  ): Promise<any> {
    return this.makeRequest<any>('GET', path as string, {
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
      body?: any
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<any> {
    return this.makeRequest<any>('POST', path as string, {
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
      body: any
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<any> {
    return this.makeRequest<any>('PUT', path as string, {
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
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<any> {
    return this.makeRequest<any>('DELETE', path as string, {
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
      body?: any
      query?: Record<string, any>
      headers?: Record<string, string>
    }
  ): Promise<any> {
    return this.makeRequest<any>('PATCH', path as string, {
      params: options.query,
      body: options.body,
      headers: options.headers
    })
  }

  /**
   * Subscribe to real-time updates
   */
  subscribe<T>(options: SubscriptionOptions, callback: SubscriptionCallback<T>): () => void {
    if (!window.api.dataApi?.subscribe) {
      throw new Error('Real-time subscriptions not supported')
    }

    const subscriptionId = `sub_${Date.now()}_${Math.random()}`

    this.subscriptions.set(subscriptionId, {
      callback: callback as SubscriptionCallback,
      options
    })

    const unsubscribe = window.api.dataApi.subscribe(options.path, (data, event) => {
      // Convert string event to SubscriptionEvent enum
      const subscriptionEvent = event as SubscriptionEvent
      callback(data, subscriptionEvent)
    })

    logger.debug(`Subscribed to ${options.path}`, { subscriptionId })

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId)
      unsubscribe()
      logger.debug(`Unsubscribed from ${options.path}`, { subscriptionId })
    }
  }

  /**
   * Cancel request by ID
   * Note: Direct IPC requests cannot be cancelled once sent
   * @deprecated This method has no effect with direct IPC
   */
  cancelRequest(requestId: string): void {
    logger.warn('Request cancellation not supported with direct IPC', { requestId })
  }

  /**
   * Cancel all pending requests
   * Note: Direct IPC requests cannot be cancelled once sent
   * @deprecated This method has no effect with direct IPC
   */
  cancelAllRequests(): void {
    logger.warn('Request cancellation not supported with direct IPC')
  }

  /**
   * Get comprehensive request statistics
   */
  getRequestStats() {
    return {
      pendingRequests: 0, // No longer tracked with direct IPC
      activeSubscriptions: this.subscriptions.size
    }
  }
}

// Export singleton instance
export const dataApiService = DataApiService.getInstance()
