import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { mockUseInvalidateCache, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useProvider,
  useProviderApiKeys,
  useProviderAuthConfig,
  useProviderMutations,
  useProviderRegistryModels,
  useProviders
} from '../useProviders'

// ─── Mock data ────────────────────────────────────────────────────────
const mockProvider1: any = {
  id: 'openai',
  name: 'OpenAI',
  isEnabled: true,
  sortOrder: 0
}

const mockProvider2: any = {
  id: 'anthropic',
  name: 'Anthropic',
  isEnabled: true,
  sortOrder: 1
}

const mockProviderList = [mockProvider1, mockProvider2]

describe('useProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return providers array from useQuery', () => {
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual(mockProviderList)
    expect(result.current.isLoading).toBe(false)
  })

  it('should return empty array when data is undefined', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('should call useQuery with /providers path', () => {
    renderHook(() => useProviders())

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', undefined)
  })

  it('should pass enabled query option when provided', () => {
    renderHook(() => useProviders({ enabled: false }))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', { query: { enabled: false } })
  })

  it('should call useMutation for POST /providers', () => {
    renderHook(() => useProviders())

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/providers', {
      refresh: ['/providers']
    })
  })

  it('should call createTrigger when addProvider is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ id: 'new-provider' })
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviders())

    const dto = { providerId: 'new-provider', name: 'New Provider' }
    await act(async () => {
      await result.current.addProvider(dto)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: dto })
  })

  it('should expose refetch from mutate', () => {
    const mockMutate = vi.fn()
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: mockMutate
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.refetch).toBe(mockMutate)
  })

  it('should perform optimistic reorder and patch each provider', async () => {
    const mockMutate = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: mockMutate
    }))
    mockDataApiService.patch.mockResolvedValue({})

    const { result } = renderHook(() => useProviders())

    const reordered = [mockProvider2, mockProvider1]
    await act(async () => {
      await result.current.reorderProviders(reordered)
    })

    // Optimistic update
    expect(mockMutate).toHaveBeenCalledWith(reordered, false)

    // Patch calls with sortOrder
    expect(mockDataApiService.patch).toHaveBeenCalledWith('/providers/anthropic', { body: { sortOrder: 0 } })
    expect(mockDataApiService.patch).toHaveBeenCalledWith('/providers/openai', { body: { sortOrder: 1 } })

    // Revalidate after success
    expect(mockMutate).toHaveBeenCalledWith()
  })

  it('should revalidate on reorder failure', async () => {
    const mockMutate = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: mockMutate
    }))
    mockDataApiService.patch.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useProviders())

    await act(async () => {
      await result.current.reorderProviders([mockProvider2, mockProvider1])
    })

    // Should still revalidate on error (rollback)
    const revalidateCalls = mockMutate.mock.calls.filter((call: any[]) => call.length === 0)
    expect(revalidateCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('useProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query single provider by ID', () => {
    mockUseQuery.mockImplementation((path: string) => ({
      data: path.includes('openai') ? mockProvider1 : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.provider).toEqual(mockProvider1)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai')
  })

  it('should include mutation functions', () => {
    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.updateProvider).toBeDefined()
    expect(result.current.deleteProvider).toBeDefined()
    expect(result.current.updateAuthConfig).toBeDefined()
    expect(result.current.addApiKey).toBeDefined()
    expect(result.current.deleteApiKey).toBeDefined()
  })
})

describe('useProviderMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set up PATCH and DELETE mutations with correct paths', () => {
    renderHook(() => useProviderMutations('openai'))

    const patchCall = mockUseMutation.mock.calls.find((c: any[]) => c[0] === 'PATCH')
    const deleteCall = mockUseMutation.mock.calls.find((c: any[]) => c[0] === 'DELETE')

    expect(patchCall).toBeDefined()
    expect(patchCall![1]).toBe('/providers/openai')
    expect(patchCall![2]).toEqual({ refresh: ['/providers'] })

    expect(deleteCall).toBeDefined()
    expect(deleteCall![1]).toBe('/providers/openai')
    expect(deleteCall![2]).toEqual({ refresh: ['/providers'] })
  })

  it('should call patchTrigger when updateProvider is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.updateProvider({ isEnabled: false })
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: { isEnabled: false } })
  })

  it('should call deleteTrigger when deleteProvider is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.deleteProvider()
    })

    expect(mockTrigger).toHaveBeenCalled()
  })

  it('should patch authConfig and invalidate auth-config cache', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)

    const { result } = renderHook(() => useProviderMutations('openai'))

    const authConfig = { authType: 'api-key' } as any
    await act(async () => {
      await result.current.updateAuthConfig(authConfig)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: { authConfig } })
    expect(mockInvalidate).toHaveBeenCalledWith('/providers/openai/auth-config')
  })

  it('should post API key and invalidate related caches', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.post.mockResolvedValue({})

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.addApiKey('sk-test-key', 'My Key')
    })

    expect(mockDataApiService.post).toHaveBeenCalledWith('/providers/openai/api-keys', {
      body: { key: 'sk-test-key', label: 'My Key' }
    })
    expect(mockInvalidate).toHaveBeenCalledWith(['/providers/openai', '/providers/openai/api-keys', '/providers'])
  })

  it('should delete API key and invalidate related caches', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockResolvedValue({})

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.deleteApiKey('key-123')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/providers/openai/api-keys/key-123')
    expect(mockInvalidate).toHaveBeenCalledWith(['/providers/openai', '/providers/openai/api-keys', '/providers'])
  })
})

describe('useProviderAuthConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query auth config for a provider', () => {
    const mockAuthConfig = { authType: 'oauth' } as any
    mockUseQuery.mockImplementation((path: string) => ({
      data: path.includes('auth-config') ? mockAuthConfig : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderAuthConfig('vertexai'))

    expect(result.current.data).toEqual(mockAuthConfig)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/vertexai/auth-config')
  })
})

describe('useProviderApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query API keys for a provider', () => {
    const mockKeys = { keys: [{ id: 'k1', key: 'sk-xxx', isEnabled: true }] }
    mockUseQuery.mockImplementation((path: string) => ({
      data: path.includes('api-keys') ? mockKeys : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderApiKeys('openai'))

    expect(result.current.data).toEqual(mockKeys)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai/api-keys')
  })
})

describe('useProviderRegistryModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query registry models for a provider', () => {
    const mockModels = [{ id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai' }]
    mockUseQuery.mockImplementation((path: string) => ({
      data: path.includes('registry-models') ? mockModels : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderRegistryModels('openai'))

    expect(result.current.data).toEqual(mockModels)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai/registry-models')
  })
})
