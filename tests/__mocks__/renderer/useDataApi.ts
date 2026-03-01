import type { BodyForPath, QueryParamsForPath, ResponseForPath } from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths, PaginationResponse } from '@shared/data/api/apiTypes'
import type { KeyedMutator } from 'swr'
import { vi } from 'vitest'

/**
 * Mock useDataApi hooks for testing
 * Provides comprehensive mocks for all data API hooks with realistic SWR-like behavior
 * Matches the actual interface from src/renderer/src/data/hooks/useDataApi.ts
 */

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
 * Matches actual signature: useQuery(path, options?) => { data, isLoading, isRefreshing, error, refetch, mutate }
 */
export const mockUseQuery = vi.fn(
  <TPath extends ConcreteApiPaths>(
    path: TPath,
    options?: {
      query?: QueryParamsForPath<TPath>
      enabled?: boolean
      swrOptions?: any
    }
  ): {
    data?: ResponseForPath<TPath, 'GET'>
    isLoading: boolean
    isRefreshing: boolean
    error?: Error
    refetch: () => void
    mutate: KeyedMutator<ResponseForPath<TPath, 'GET'>>
  } => {
    // Check if query is disabled
    if (options?.enabled === false) {
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined) as unknown as KeyedMutator<ResponseForPath<TPath, 'GET'>>
      }
    }

    const mockData = createMockDataForPath(path)

    return {
      data: mockData as ResponseForPath<TPath, 'GET'>,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn().mockResolvedValue(mockData) as unknown as KeyedMutator<ResponseForPath<TPath, 'GET'>>
    }
  }
)

/**
 * Mock useMutation hook
 * Matches actual signature: useMutation(method, path, options?) => { trigger, isLoading, error }
 */
export const mockUseMutation = vi.fn(
  <TPath extends ConcreteApiPaths, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
    method: TMethod,
    _path: TPath,
    _options?: {
      onSuccess?: (data: ResponseForPath<TPath, TMethod>) => void
      onError?: (error: Error) => void
      refresh?: ConcreteApiPaths[]
      optimisticData?: ResponseForPath<TPath, TMethod>
      swrOptions?: any
    }
  ): {
    trigger: (data?: {
      body?: BodyForPath<TPath, TMethod>
      query?: QueryParamsForPath<TPath>
    }) => Promise<ResponseForPath<TPath, TMethod>>
    isLoading: boolean
    error: Error | undefined
  } => {
    const mockTrigger = vi.fn(
      async (_data?: { body?: BodyForPath<TPath, TMethod>; query?: QueryParamsForPath<TPath> }) => {
        // Simulate different responses based on method
        switch (method) {
          case 'POST':
            return { id: 'new_item', created: true } as ResponseForPath<TPath, TMethod>
          case 'PUT':
          case 'PATCH':
            return { id: 'updated_item', updated: true } as ResponseForPath<TPath, TMethod>
          case 'DELETE':
            return { deleted: true } as ResponseForPath<TPath, TMethod>
          default:
            return { success: true } as ResponseForPath<TPath, TMethod>
        }
      }
    )

    return {
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }
  }
)

/**
 * Mock usePaginatedQuery hook
 * Matches actual signature: usePaginatedQuery(path, options?) => { items, total, page, isLoading, isRefreshing, error, hasNext, hasPrev, prevPage, nextPage, refresh, reset }
 */
export const mockUsePaginatedQuery = vi.fn(
  <TPath extends ConcreteApiPaths>(
    path: TPath,
    _options?: {
      query?: Omit<QueryParamsForPath<TPath>, 'page' | 'limit'>
      limit?: number
      swrOptions?: any
    }
  ): ResponseForPath<TPath, 'GET'> extends PaginationResponse<infer T>
    ? {
        items: T[]
        total: number
        page: number
        isLoading: boolean
        isRefreshing: boolean
        error?: Error
        hasNext: boolean
        hasPrev: boolean
        prevPage: () => void
        nextPage: () => void
        refresh: () => void
        reset: () => void
      }
    : never => {
    const mockItems = path
      ? [
          { id: 'item1', name: 'Mock Item 1' },
          { id: 'item2', name: 'Mock Item 2' },
          { id: 'item3', name: 'Mock Item 3' }
        ]
      : []

    return {
      items: mockItems,
      total: mockItems.length,
      page: 1,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      hasPrev: false,
      prevPage: vi.fn(),
      nextPage: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn()
    } as unknown as ResponseForPath<TPath, 'GET'> extends PaginationResponse<infer T>
      ? {
          items: T[]
          total: number
          page: number
          isLoading: boolean
          isRefreshing: boolean
          error?: Error
          hasNext: boolean
          hasPrev: boolean
          prevPage: () => void
          nextPage: () => void
          refresh: () => void
          reset: () => void
        }
      : never
  }
)

/**
 * Mock useInvalidateCache hook
 * Matches actual signature: useInvalidateCache() => (keys?) => Promise<any>
 */
export const mockUseInvalidateCache = vi.fn((): ((keys?: string | string[] | boolean) => Promise<any>) => {
  const invalidate = vi.fn(async (_keys?: string | string[] | boolean) => {
    return Promise.resolve()
  })
  return invalidate
})

/**
 * Mock prefetch function
 * Matches actual signature: prefetch(path, options?) => Promise<ResponseForPath<TPath, 'GET'>>
 */
export const mockPrefetch = vi.fn(
  async <TPath extends ConcreteApiPaths>(
    path: TPath,
    _options?: {
      query?: QueryParamsForPath<TPath>
    }
  ): Promise<ResponseForPath<TPath, 'GET'>> => {
    return createMockDataForPath(path) as ResponseForPath<TPath, 'GET'>
  }
)

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
  mockQueryData: <TPath extends ConcreteApiPaths>(path: TPath, data: ResponseForPath<TPath, 'GET'>) => {
    mockUseQuery.mockImplementation((queryPath, _options) => {
      if (queryPath === path) {
        return {
          data,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn().mockResolvedValue(data)
        }
      }
      // Default behavior for other paths
      const defaultData = createMockDataForPath(queryPath)
      return {
        data: defaultData,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn().mockResolvedValue(defaultData)
      }
    })
  },

  /**
   * Set up useQuery to return loading state
   */
  mockQueryLoading: (path: ConcreteApiPaths) => {
    mockUseQuery.mockImplementation((queryPath, _options) => {
      if (queryPath === path) {
        return {
          data: undefined,
          isLoading: true,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      const defaultData = createMockDataForPath(queryPath)
      return {
        data: defaultData,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn().mockResolvedValue(defaultData)
      }
    })
  },

  /**
   * Set up useQuery to return error state
   */
  mockQueryError: (path: ConcreteApiPaths, error: Error) => {
    mockUseQuery.mockImplementation((queryPath, _options) => {
      if (queryPath === path) {
        return {
          data: undefined,
          isLoading: false,
          isRefreshing: false,
          error,
          refetch: vi.fn(),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      const defaultData = createMockDataForPath(queryPath)
      return {
        data: defaultData,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn().mockResolvedValue(defaultData)
      }
    })
  },

  /**
   * Set up useMutation to simulate success with specific result
   */
  mockMutationSuccess: <TPath extends ConcreteApiPaths, TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
    method: TMethod,
    path: TPath,
    result: ResponseForPath<TPath, TMethod>
  ) => {
    mockUseMutation.mockImplementation((mutationMethod, mutationPath, _options) => {
      if (mutationPath === path && mutationMethod === method) {
        return {
          trigger: vi.fn().mockResolvedValue(result),
          isLoading: false,
          error: undefined
        }
      }
      // Default behavior
      return {
        trigger: vi.fn().mockResolvedValue({ success: true }),
        isLoading: false,
        error: undefined
      }
    })
  },

  /**
   * Set up useMutation to simulate error
   */
  mockMutationError: <TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
    method: TMethod,
    path: ConcreteApiPaths,
    error: Error
  ) => {
    mockUseMutation.mockImplementation((mutationMethod, mutationPath, _options) => {
      if (mutationPath === path && mutationMethod === method) {
        return {
          trigger: vi.fn().mockRejectedValue(error),
          isLoading: false,
          error: undefined
        }
      }
      // Default behavior
      return {
        trigger: vi.fn().mockResolvedValue({ success: true }),
        isLoading: false,
        error: undefined
      }
    })
  },

  /**
   * Set up useMutation to be in loading state
   */
  mockMutationLoading: <TMethod extends 'POST' | 'PUT' | 'DELETE' | 'PATCH'>(
    method: TMethod,
    path: ConcreteApiPaths
  ) => {
    mockUseMutation.mockImplementation((mutationMethod, mutationPath, _options) => {
      if (mutationPath === path && mutationMethod === method) {
        return {
          trigger: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
          isLoading: true,
          error: undefined
        }
      }
      // Default behavior
      return {
        trigger: vi.fn().mockResolvedValue({ success: true }),
        isLoading: false,
        error: undefined
      }
    })
  },

  /**
   * Set up usePaginatedQuery to return specific items
   */
  mockPaginatedData: <TPath extends ConcreteApiPaths>(
    path: TPath,
    items: any[],
    options?: { total?: number; page?: number; hasNext?: boolean; hasPrev?: boolean }
  ) => {
    mockUsePaginatedQuery.mockImplementation((queryPath, _queryOptions) => {
      if (queryPath === path) {
        return {
          items,
          total: options?.total ?? items.length,
          page: options?.page ?? 1,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          hasNext: options?.hasNext ?? false,
          hasPrev: options?.hasPrev ?? false,
          prevPage: vi.fn(),
          nextPage: vi.fn(),
          refresh: vi.fn(),
          reset: vi.fn()
        }
      }
      // Default behavior
      return {
        items: [],
        total: 0,
        page: 1,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: false,
        hasPrev: false,
        prevPage: vi.fn(),
        nextPage: vi.fn(),
        refresh: vi.fn(),
        reset: vi.fn()
      }
    })
  }
}
