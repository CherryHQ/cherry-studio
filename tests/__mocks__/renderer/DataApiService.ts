import type { ApiClient, ConcreteApiPaths } from '@shared/data/api/apiSchemas'
import type { DataResponse } from '@shared/data/api/apiTypes'
import { vi } from 'vitest'

/**
 * Mock DataApiService for testing
 * Provides a comprehensive mock of the DataApiService with realistic behavior
 */

// Mock response utilities
const createMockResponse = <T>(data: T, success = true): DataResponse<T> => ({
  id: 'mock-id',
  status: success ? 200 : 500,
  data,
  ...(success ? {} : { error: { code: 'MOCK_ERROR', message: 'Mock error', details: {}, status: 500 } })
})

const createMockError = (message: string): DataResponse<never> => ({
  id: 'mock-error-id',
  status: 500,
  error: {
    code: 'MOCK_ERROR',
    message,
    details: {},
    status: 500
  }
})

/**
 * Mock implementation of DataApiService
 */
export const createMockDataApiService = (customBehavior: Partial<ApiClient> = {}): ApiClient => {
  const mockService: ApiClient = {
    // HTTP Methods
    get: vi.fn(async (path: ConcreteApiPaths) => {
      // Default mock behavior - return raw data based on path
      return getMockDataForPath(path, 'GET') as any
    }),

    post: vi.fn(async (path: ConcreteApiPaths) => {
      return getMockDataForPath(path, 'POST') as any
    }),

    put: vi.fn(async (path: ConcreteApiPaths) => {
      return getMockDataForPath(path, 'PUT') as any
    }),

    patch: vi.fn(async (path: ConcreteApiPaths) => {
      return getMockDataForPath(path, 'PATCH') as any
    }),

    delete: vi.fn(async () => {
      return { deleted: true } as any
    }),

    // Apply custom behavior overrides
    ...customBehavior
  }

  return mockService
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

// Default mock instance
export const mockDataApiService = createMockDataApiService()

// Singleton instance mock
export const MockDataApiService = {
  DataApiService: class MockDataApiService {
    static getInstance() {
      return mockDataApiService
    }

    // Instance methods delegate to the mock
    async get(path: ConcreteApiPaths, options?: any) {
      return mockDataApiService.get(path, options)
    }

    async post(path: ConcreteApiPaths, options?: any) {
      return mockDataApiService.post(path, options)
    }

    async put(path: ConcreteApiPaths, options?: any) {
      return mockDataApiService.put(path, options)
    }

    async patch(path: ConcreteApiPaths, options?: any) {
      return mockDataApiService.patch(path, options)
    }

    async delete(path: ConcreteApiPaths, options?: any) {
      return mockDataApiService.delete(path, options)
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
  },

  /**
   * Set custom response for a specific path and method
   */
  setCustomResponse: (path: ConcreteApiPaths, method: string, response: any) => {
    const methodFn = mockDataApiService[method.toLowerCase() as keyof ApiClient] as any
    if (vi.isMockFunction(methodFn)) {
      methodFn.mockImplementation(async (requestPath: string) => {
        if (requestPath === path) {
          return createMockResponse(response)
        }
        // Fall back to default behavior
        return createMockResponse(getMockDataForPath(requestPath as ConcreteApiPaths, method))
      })
    }
  },

  /**
   * Set error response for a specific path and method
   */
  setErrorResponse: (path: ConcreteApiPaths, method: string, errorMessage: string) => {
    const methodFn = mockDataApiService[method.toLowerCase() as keyof ApiClient] as any
    if (vi.isMockFunction(methodFn)) {
      methodFn.mockImplementation(async (requestPath: string) => {
        if (requestPath === path) {
          return createMockError(errorMessage)
        }
        // Fall back to default behavior
        return createMockResponse(getMockDataForPath(requestPath as ConcreteApiPaths, method))
      })
    }
  },

  /**
   * Get call count for a specific method
   */
  getCallCount: (method: keyof ApiClient): number => {
    const methodFn = mockDataApiService[method] as any
    return vi.isMockFunction(methodFn) ? methodFn.mock.calls.length : 0
  },

  /**
   * Get calls for a specific method
   */
  getCalls: (method: keyof ApiClient): any[] => {
    const methodFn = mockDataApiService[method] as any
    return vi.isMockFunction(methodFn) ? methodFn.mock.calls : []
  }
}
