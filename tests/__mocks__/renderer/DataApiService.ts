import type { ConcreteApiPaths, DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'
import { vi } from 'vitest'

/**
 * Mock DataApiService for testing
 * Provides a comprehensive mock of the DataApiService with realistic behavior
 * Matches the actual DataApiService interface from src/renderer/data/DataApiService.ts
 */

/**
 * Retry options interface (matches actual)
 */
interface RetryOptions {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
}

/**
 * Get mock data based on API path and method
 * Provides realistic mock responses for common API endpoints
 */
function getMockDataForPath(path: ConcreteApiPaths, method: string): any {
  // Parse path to determine data type
  if (path.includes('/topics')) {
    if (method === 'GET' && path.endsWith('/topics')) {
      return {
        topics: [
          { id: 'topic1', name: 'Mock Topic 1', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'topic2', name: 'Mock Topic 2', createdAt: '2024-01-02T00:00:00Z' }
        ],
        total: 2
      }
    }
    if (method === 'GET' && path.match(/\/topics\/[^/]+$/)) {
      return {
        id: 'topic1',
        name: 'Mock Topic',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z'
      }
    }
    if (method === 'POST' && path.endsWith('/topics')) {
      return {
        id: 'new_topic',
        name: 'New Mock Topic',
        createdAt: new Date().toISOString()
      }
    }
  }

  if (path.includes('/messages')) {
    if (method === 'GET') {
      return {
        messages: [
          { id: 'msg1', content: 'Mock message 1', role: 'user', timestamp: '2024-01-01T00:00:00Z' },
          { id: 'msg2', content: 'Mock message 2', role: 'assistant', timestamp: '2024-01-01T00:01:00Z' }
        ],
        total: 2
      }
    }
    if (method === 'POST') {
      return {
        id: 'new_message',
        content: 'New mock message',
        role: 'user',
        timestamp: new Date().toISOString()
      }
    }
  }

  if (path.includes('/preferences')) {
    if (method === 'GET') {
      return {
        preferences: {
          'ui.theme': 'light',
          'ui.language': 'en',
          'data.export.format': 'markdown'
        }
      }
    }
    if (method === 'POST' || method === 'PUT') {
      return { updated: true, timestamp: new Date().toISOString() }
    }
  }

  // Default mock data
  return {
    id: 'mock_id',
    data: 'mock_data',
    timestamp: new Date().toISOString()
  }
}

/**
 * Create a mock DataApiService with realistic behavior
 */
export const createMockDataApiService = (customBehavior: Partial<ReturnType<typeof createMockDataApiService>> = {}) => {
  // Data change fan-out (mirrors the real service: endpoint → listeners)
  const dataChangeListeners = new Map<GetMethodApiPaths, Set<(effects: DataApiDataChangeEffect[]) => void>>()

  // Retry configuration
  let retryOptions: RetryOptions = {
    maxRetries: 2,
    retryDelay: 1000,
    backoffMultiplier: 2
  }

  const mockService = {
    // ============ HTTP Methods ============

    get: vi.fn(
      async <TPath extends ConcreteApiPaths>(
        path: TPath,
        _options?: { query?: any; headers?: Record<string, string> }
      ) => {
        return getMockDataForPath(path, 'GET')
      }
    ),

    post: vi.fn(
      async <TPath extends ConcreteApiPaths>(
        path: TPath,
        _options: { body?: any; query?: Record<string, any>; headers?: Record<string, string> }
      ) => {
        return getMockDataForPath(path, 'POST')
      }
    ),

    put: vi.fn(
      async <TPath extends ConcreteApiPaths>(
        path: TPath,
        _options: { body: any; query?: Record<string, any>; headers?: Record<string, string> }
      ) => {
        return getMockDataForPath(path, 'PUT')
      }
    ),

    patch: vi.fn(
      async <TPath extends ConcreteApiPaths>(
        path: TPath,
        _options: { body?: any; query?: Record<string, any>; headers?: Record<string, string> }
      ) => {
        return getMockDataForPath(path, 'PATCH')
      }
    ),

    delete: vi.fn(
      async <TPath extends ConcreteApiPaths>(
        _path: TPath,
        _options?: { query?: Record<string, any>; headers?: Record<string, string> }
      ) => {
        return { deleted: true }
      }
    ),

    // ============ Data Change Notifications ============

    onDataChanged: vi.fn(
      (
        endpoints: GetMethodApiPaths | GetMethodApiPaths[],
        listener: (effects: DataApiDataChangeEffect[]) => void
      ): (() => void) => {
        // Mirrors production: one unique wrapper per registration.
        const registered = (effects: DataApiDataChangeEffect[]) => listener(effects)
        const endpointList = [...new Set(Array.isArray(endpoints) ? endpoints : [endpoints])]
        for (const endpoint of endpointList) {
          let listeners = dataChangeListeners.get(endpoint)
          if (!listeners) {
            listeners = new Set()
            dataChangeListeners.set(endpoint, listeners)
          }
          listeners.add(registered)
        }
        return () => {
          for (const endpoint of endpointList) {
            const listeners = dataChangeListeners.get(endpoint)
            if (!listeners) continue
            listeners.delete(registered)
            if (listeners.size === 0) {
              dataChangeListeners.delete(endpoint)
            }
          }
        }
      }
    ),

    // ============ Retry Configuration ============

    configureRetry: vi.fn((options: Partial<RetryOptions>): void => {
      retryOptions = {
        ...retryOptions,
        ...options
      }
    }),

    getRetryConfig: vi.fn((): RetryOptions => {
      return { ...retryOptions }
    }),

    // ============ Internal State Access for Testing ============

    _getMockState: () => ({
      dataChangeListeners: new Map(dataChangeListeners),
      retryOptions: { ...retryOptions }
    }),

    _resetMockState: () => {
      dataChangeListeners.clear()
      retryOptions = {
        maxRetries: 2,
        retryDelay: 1000,
        backoffMultiplier: 2
      }
    },

    /**
     * Deliver one data change notification exactly like the real fan-out:
     * exact endpoint match, all matching entries merged into ONE callback per
     * listener, listener errors swallowed (isolation).
     */
    _emitDataChange: (effects: DataApiDataChangeEffect[]) => {
      const matched = new Map<(effects: DataApiDataChangeEffect[]) => void, DataApiDataChangeEffect[]>()
      for (const effect of effects) {
        const listeners = dataChangeListeners.get(effect.endpoint)
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
        } catch {
          // isolated, mirroring production
        }
      }
    },

    // Apply custom behavior overrides
    ...customBehavior
  }

  return mockService
}

// Default mock instance
export const mockDataApiService = createMockDataApiService()

// Singleton instance mock
export const MockDataApiService = {
  DataApiService: class MockDataApiService {
    static getInstance() {
      return mockDataApiService
    }

    // ============ HTTP Methods ============
    async get<TPath extends ConcreteApiPaths>(
      path: TPath,
      options?: { query?: any; headers?: Record<string, string> }
    ) {
      return mockDataApiService.get(path, options)
    }

    async post<TPath extends ConcreteApiPaths>(
      path: TPath,
      options: { body?: any; query?: Record<string, any>; headers?: Record<string, string> }
    ) {
      return mockDataApiService.post(path, options)
    }

    async put<TPath extends ConcreteApiPaths>(
      path: TPath,
      options: { body: any; query?: Record<string, any>; headers?: Record<string, string> }
    ) {
      return mockDataApiService.put(path, options)
    }

    async patch<TPath extends ConcreteApiPaths>(
      path: TPath,
      options: { body?: any; query?: Record<string, any>; headers?: Record<string, string> }
    ) {
      return mockDataApiService.patch(path, options)
    }

    async delete<TPath extends ConcreteApiPaths>(
      path: TPath,
      options?: { query?: Record<string, any>; headers?: Record<string, string> }
    ) {
      return mockDataApiService.delete(path, options)
    }

    // ============ Data Change Notifications ============
    onDataChanged(
      endpoints: GetMethodApiPaths | GetMethodApiPaths[],
      listener: (effects: DataApiDataChangeEffect[]) => void
    ): () => void {
      return mockDataApiService.onDataChanged(endpoints, listener)
    }

    // ============ Retry Configuration ============
    configureRetry(options: Partial<RetryOptions>): void {
      return mockDataApiService.configureRetry(options)
    }

    getRetryConfig(): RetryOptions {
      return mockDataApiService.getRetryConfig()
    }
  },
  dataApiService: mockDataApiService
}

/**
 * Utility functions for testing
 */
export const MockDataApiUtils = {
  /**
   * Reset all mock function call counts and implementations
   */
  resetMocks: () => {
    Object.values(mockDataApiService).forEach((method) => {
      if (vi.isMockFunction(method)) {
        method.mockClear()
      }
    })
    mockDataApiService._resetMockState()
  },

  /**
   * Set custom response for a specific path and method
   */
  setCustomResponse: (path: ConcreteApiPaths, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', response: any) => {
    const methodFn = mockDataApiService[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete']
    if (vi.isMockFunction(methodFn)) {
      methodFn.mockImplementation(async (requestPath: string) => {
        if (requestPath === path) {
          return response
        }
        return getMockDataForPath(requestPath as ConcreteApiPaths, method)
      })
    }
  },

  /**
   * Set error response for a specific path and method
   */
  setErrorResponse: (path: ConcreteApiPaths, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', error: Error) => {
    const methodFn = mockDataApiService[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete']
    if (vi.isMockFunction(methodFn)) {
      methodFn.mockImplementation(async (requestPath: string) => {
        if (requestPath === path) {
          throw error
        }
        return getMockDataForPath(requestPath as ConcreteApiPaths, method)
      })
    }
  },

  /**
   * Get call count for a specific method
   */
  getCallCount: (method: 'get' | 'post' | 'put' | 'patch' | 'delete'): number => {
    const methodFn = mockDataApiService[method]
    return vi.isMockFunction(methodFn) ? methodFn.mock.calls.length : 0
  },

  /**
   * Get calls for a specific method
   */
  getCalls: (method: 'get' | 'post' | 'put' | 'patch' | 'delete'): any[] => {
    const methodFn = mockDataApiService[method]
    return vi.isMockFunction(methodFn) ? methodFn.mock.calls : []
  },

  /**
   * Deliver a data change notification to registered onDataChanged listeners
   * (same batch-merge and error-isolation semantics as production).
   */
  emitDataChange: (effects: DataApiDataChangeEffect[]) => {
    mockDataApiService._emitDataChange(effects)
  },

  /**
   * Get current mock state
   */
  getCurrentState: () => {
    return mockDataApiService._getMockState()
  }
}
