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
 * - Batch request support for performance
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
import type { ApiClient, ConcreteApiPaths } from '@shared/data/api/apiSchemas'
import type {
  BatchRequest,
  BatchResponse,
  DataRequest,
  DataResponse,
  HttpMethod,
  SubscriptionCallback,
  SubscriptionEvent,
  SubscriptionOptions,
  TransactionRequest
} from '@shared/data/api/apiTypes'
import { toDataApiError } from '@shared/data/api/errorCodes'

const logger = loggerService.withContext('DataApiService')

/**
 * Retry options interface
 */
interface RetryOptions {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
  retryCondition: (error: Error) => boolean
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
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 2,
    retryDelay: 1000,
    backoffMultiplier: 2,
    retryCondition: (error: Error) => {
      // Retry on network errors or temporary failures
      const message = error.message.toLowerCase()
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('unavailable') ||
        message.includes('500') ||
        message.includes('503')
      )
    }
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
   * Send request via IPC with direct return and retry logic
   */
  private async sendRequest<T>(request: DataRequest, retryCount = 0): Promise<T> {
    if (!window.api.dataApi.request) {
      throw new Error('Data API not available')
    }

    try {
      logger.debug(`Making ${request.method} request to ${request.path}`, { request })

      // Direct IPC call with timeout
      const response = await Promise.race([
        window.api.dataApi.request(request),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Request timeout: ${request.path}`)), 3000))
      ])

      if (response.error) {
        throw new Error(response.error.message)
      }

      logger.debug(`Request succeeded: ${request.method} ${request.path}`, {
        status: response.status,
        hasData: !!response.data
      })

      return response.data as T
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.debug(`Request failed: ${request.method} ${request.path}`, error as Error)

      // Check if should retry
      if (retryCount < this.defaultRetryOptions.maxRetries && this.defaultRetryOptions.retryCondition(error as Error)) {
        logger.debug(
          `Retrying request attempt ${retryCount + 1}/${this.defaultRetryOptions.maxRetries}: ${request.path}`,
          { error: errorMessage }
        )

        // Calculate delay with exponential backoff
        const delay =
          this.defaultRetryOptions.retryDelay * Math.pow(this.defaultRetryOptions.backoffMultiplier, retryCount)

        await new Promise((resolve) => setTimeout(resolve, delay))

        // Create new request with new ID for retry
        const retryRequest = { ...request, id: this.generateRequestId() }
        return this.sendRequest<T>(retryRequest, retryCount + 1)
      }

      throw error
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
   * Execute multiple requests in batch
   */
  async batch(requests: DataRequest[], options: { parallel?: boolean } = {}): Promise<BatchResponse> {
    const batchRequest: BatchRequest = {
      requests,
      parallel: options.parallel ?? true
    }

    return this.makeRequest<BatchResponse>('POST', '/batch', { body: batchRequest })
  }

  /**
   * Execute requests in a transaction
   */
  async transaction(operations: DataRequest[], options?: TransactionRequest['options']): Promise<DataResponse[]> {
    const transactionRequest: TransactionRequest = {
      operations,
      options
    }

    return this.makeRequest<DataResponse[]>('POST', '/transaction', { body: transactionRequest })
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
