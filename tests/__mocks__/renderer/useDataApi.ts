import type { ConcreteApiPaths } from '@shared/data/api/apiSchemas'
import type { PaginatedResponse } from '@shared/data/api/apiTypes'
import { vi } from 'vitest'

/**
 * Mock useDataApi hooks for testing
 * Provides comprehensive mocks for all data API hooks with realistic SWR-like behavior
 */

// Mock SWR response interface
interface MockSWRResponse<T> {
  data?: T
  error?: Error
  isLoading: boolean
  isValidating: boolean
  mutate: (data?: T | Promise<T> | ((data: T) => T)) => Promise<T | undefined>
}

// Mock mutation response interface
interface MockMutationResponse<T> {
  data?: T
  error?: Error
  isMutating: boolean
  trigger: (...args: any[]) => Promise<T>
  reset: () => void
}

// Mock paginated response interface
interface MockPaginatedResponse<T> extends MockSWRResponse<PaginatedResponse<T>> {
  loadMore: () => void
  isLoadingMore: boolean
  hasMore: boolean
  items: T[]
}

/**
 * Create mock data based on API path
 */
function createMockDataForPath(path: ConcreteApiPaths): any {
  if (path.includes('/topics')) {
    if (path.endsWith('/topics')) {
      return {
        topics: [
          { id: 'topic1', name: 'Mock Topic 1', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'topic2', name: 'Mock Topic 2', createdAt: '2024-01-02T00:00:00Z' }
        ],
        total: 2
      }
    }
    return {
      id: 'topic1',
      name: 'Mock Topic',
      messages: [],
      createdAt: '2024-01-01T00:00:00Z'
    }
  }

  if (path.includes('/messages')) {
    return {
      messages: [
        { id: 'msg1', content: 'Mock message 1', role: 'user' },
        { id: 'msg2', content: 'Mock message 2', role: 'assistant' }
      ],
      total: 2
    }
  }

  return { id: 'mock_id', data: 'mock_data' }
}

/**
 * Mock useQuery hook
 */
export const mockUseQuery = vi.fn(
  <TPath extends ConcreteApiPaths>(path: TPath | null, _query?: any, options?: any): MockSWRResponse<any> => {
    const isLoading = options?.initialLoading ?? false
    const hasError = options?.shouldError ?? false

    if (hasError) {
      return {
        data: undefined,
        error: new Error(`Mock error for ${path}`),
        isLoading: false,
        isValidating: false,
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    }

    const mockData = path ? createMockDataForPath(path) : undefined

    return {
      data: mockData,
      error: undefined,
      isLoading,
      isValidating: false,
      mutate: vi.fn().mockResolvedValue(mockData)
    }
  }
)

/**
 * Mock useMutation hook
 */
export const mockUseMutation = vi.fn(
  <TPath extends ConcreteApiPaths, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
    path: TPath,
    method: TMethod,
    options?: any
  ): MockMutationResponse<any> => {
    const isMutating = options?.initialMutating ?? false
    const hasError = options?.shouldError ?? false

    const mockTrigger = vi.fn(async (...args: any[]) => {
      if (hasError) {
        throw new Error(`Mock mutation error for ${method} ${path}`)
      }

      // Simulate different responses based on method
      switch (method) {
        case 'POST':
          return { id: 'new_item', created: true, ...args[0] }
        case 'PUT':
        case 'PATCH':
          return { id: 'updated_item', updated: true, ...args[0] }
        case 'DELETE':
          return { deleted: true }
        default:
          return { success: true }
      }
    })

    return {
      data: undefined,
      error: undefined,
      isMutating,
      trigger: mockTrigger,
      reset: vi.fn()
    }
  }
)

/**
 * Mock usePaginatedQuery hook
 */
export const mockUsePaginatedQuery = vi.fn(
  <TPath extends ConcreteApiPaths>(path: TPath | null, _query?: any, options?: any): MockPaginatedResponse<any> => {
    const isLoading = options?.initialLoading ?? false
    const isLoadingMore = options?.initialLoadingMore ?? false
    const hasError = options?.shouldError ?? false

    if (hasError) {
      return {
        data: undefined,
        error: new Error(`Mock paginated error for ${path}`),
        isLoading: false,
        isValidating: false,
        mutate: vi.fn().mockResolvedValue(undefined),
        loadMore: vi.fn(),
        isLoadingMore: false,
        hasMore: false,
        items: []
      }
    }

    const mockItems = path
      ? [
          { id: 'item1', name: 'Mock Item 1' },
          { id: 'item2', name: 'Mock Item 2' },
          { id: 'item3', name: 'Mock Item 3' }
        ]
      : []

    const mockData: PaginatedResponse<any> = {
      items: mockItems,
      total: mockItems.length,
      page: 1,
      pageCount: 1,
      hasNext: false,
      hasPrev: false
    }

    return {
      data: mockData,
      error: undefined,
      isLoading,
      isValidating: false,
      mutate: vi.fn().mockResolvedValue(mockData),
      loadMore: vi.fn(),
      isLoadingMore,
      hasMore: mockData.hasNext,
      items: mockItems
    }
  }
)

/**
 * Mock useInvalidateCache hook
 */
export const mockUseInvalidateCache = vi.fn(() => {
  return {
    invalidate: vi.fn(async () => {
      // Mock cache invalidation
      return Promise.resolve()
    }),
    invalidateAll: vi.fn(async () => {
      // Mock invalidate all caches
      return Promise.resolve()
    })
  }
})

/**
 * Mock prefetch function
 */
export const mockPrefetch = vi.fn(async <TPath extends ConcreteApiPaths>(_path: TPath): Promise<any> => {
  // Mock prefetch - return mock data
  return createMockDataForPath(_path)
})

/**
 * Export all mocks as a unified module
 */
export const MockUseDataApi = {
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
  usePaginatedQuery: mockUsePaginatedQuery,
  useInvalidateCache: mockUseInvalidateCache,
  prefetch: mockPrefetch
}

/**
 * Utility functions for testing
 */
export const MockUseDataApiUtils = {
  /**
   * Reset all hook mock call counts and implementations
   */
  resetMocks: () => {
    mockUseQuery.mockClear()
    mockUseMutation.mockClear()
    mockUsePaginatedQuery.mockClear()
    mockUseInvalidateCache.mockClear()
    mockPrefetch.mockClear()
  },

  /**
   * Set up useQuery to return specific data
   */
  mockQueryData: <T>(path: ConcreteApiPaths, data: T) => {
    mockUseQuery.mockImplementation((queryPath, query, options) => {
      if (queryPath === path) {
        return {
          data,
          error: undefined,
          isLoading: false,
          isValidating: false,
          mutate: vi.fn().mockResolvedValue(data)
        }
      }
      // Default behavior for other paths
      return (
        mockUseQuery.getMockImplementation()?.(queryPath, query, options) || {
          data: undefined,
          error: undefined,
          isLoading: false,
          isValidating: false,
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      )
    })
  },

  /**
   * Set up useQuery to return loading state
   */
  mockQueryLoading: (path: ConcreteApiPaths) => {
    mockUseQuery.mockImplementation((queryPath, query, options) => {
      if (queryPath === path) {
        return {
          data: undefined,
          error: undefined,
          isLoading: true,
          isValidating: true,
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return (
        mockUseQuery.getMockImplementation()?.(queryPath, query, options) || {
          data: undefined,
          error: undefined,
          isLoading: false,
          isValidating: false,
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      )
    })
  },

  /**
   * Set up useQuery to return error state
   */
  mockQueryError: (path: ConcreteApiPaths, error: Error) => {
    mockUseQuery.mockImplementation((queryPath, query, options) => {
      if (queryPath === path) {
        return {
          data: undefined,
          error,
          isLoading: false,
          isValidating: false,
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return (
        mockUseQuery.getMockImplementation()?.(queryPath, query, options) || {
          data: undefined,
          error: undefined,
          isLoading: false,
          isValidating: false,
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      )
    })
  },

  /**
   * Set up useMutation to simulate success
   */
  mockMutationSuccess: <T>(path: ConcreteApiPaths, method: string, result: T) => {
    mockUseMutation.mockImplementation((mutationPath, mutationMethod, options) => {
      if (mutationPath === path && mutationMethod === method) {
        return {
          data: undefined,
          error: undefined,
          isMutating: false,
          trigger: vi.fn().mockResolvedValue(result),
          reset: vi.fn()
        }
      }
      return (
        mockUseMutation.getMockImplementation()?.(mutationPath, mutationMethod, options) || {
          data: undefined,
          error: undefined,
          isMutating: false,
          trigger: vi.fn().mockResolvedValue({}),
          reset: vi.fn()
        }
      )
    })
  },

  /**
   * Set up useMutation to simulate error
   */
  mockMutationError: (path: ConcreteApiPaths, method: string, error: Error) => {
    mockUseMutation.mockImplementation((mutationPath, mutationMethod, options) => {
      if (mutationPath === path && mutationMethod === method) {
        return {
          data: undefined,
          error: undefined,
          isMutating: false,
          trigger: vi.fn().mockRejectedValue(error),
          reset: vi.fn()
        }
      }
      return (
        mockUseMutation.getMockImplementation()?.(mutationPath, mutationMethod, options) || {
          data: undefined,
          error: undefined,
          isMutating: false,
          trigger: vi.fn().mockResolvedValue({}),
          reset: vi.fn()
        }
      )
    })
  }
}
