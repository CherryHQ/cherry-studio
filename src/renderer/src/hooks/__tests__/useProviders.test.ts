import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { mockUseInvalidateCache, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../tests/__mocks__/RendererLoggerService'
import {
  useProvider,
  useProviderActions,
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

  it('should log and rethrow addProvider errors', async () => {
    const error = new Error('Create failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviders())

    await act(async () => {
      await expect(result.current.addProvider({ providerId: 'new', name: 'New' })).rejects.toThrow('Create failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to create provider', { providerId: 'new', error })
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
    const error = new Error('Network error')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: mockMutate
    }))
    mockDataApiService.patch.mockRejectedValue(error)

    const { result } = renderHook(() => useProviders())

    await act(async () => {
      await expect(result.current.reorderProviders([mockProvider2, mockProvider1])).rejects.toThrow('Network error')
    })

    const revalidateCalls = mockMutate.mock.calls.filter((call: any[]) => call.length === 0)
    expect(revalidateCalls.length).toBeGreaterThanOrEqual(1)
    expect(loggerSpy).toHaveBeenCalledWith('Failed to reorder providers, reverting optimistic state', error)
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

  it('should build correct path for hyphenated provider IDs', () => {
    renderHook(() => useProvider('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai-main')
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

  it('should build correct mutation paths for hyphenated provider IDs', () => {
    renderHook(() => useProviderMutations('openai-main'))

    const patchCall = mockUseMutation.mock.calls.find((c: any[]) => c[0] === 'PATCH')
    const deleteCall = mockUseMutation.mock.calls.find((c: any[]) => c[0] === 'DELETE')

    expect(patchCall![1]).toBe('/providers/openai-main')
    expect(deleteCall![1]).toBe('/providers/openai-main')
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

  it('should log and rethrow updateProvider errors', async () => {
    const error = new Error('Patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.updateProvider({ isEnabled: false })).rejects.toThrow('Patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update provider', { providerId: 'openai', error })
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

  it('should build correct API key paths for hyphenated provider IDs', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.post.mockResolvedValue({})
    mockDataApiService.delete.mockResolvedValue({})

    const { result } = renderHook(() => useProviderMutations('openai-main'))

    await act(async () => {
      await result.current.addApiKey('sk-test-key', 'My Key')
      await result.current.deleteApiKey('key-456')
    })

    expect(mockDataApiService.post).toHaveBeenCalledWith('/providers/openai-main/api-keys', {
      body: { key: 'sk-test-key', label: 'My Key' }
    })
    expect(mockDataApiService.delete).toHaveBeenCalledWith('/providers/openai-main/api-keys/key-456')
    expect(mockInvalidate).toHaveBeenCalledWith([
      '/providers/openai-main',
      '/providers/openai-main/api-keys',
      '/providers'
    ])
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

  it('should log and rethrow addApiKey errors', async () => {
    const error = new Error('Post failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.post.mockRejectedValue(error)

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.addApiKey('sk-test')).rejects.toThrow('Post failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to add API key', { providerId: 'openai', error })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('should log and rethrow deleteApiKey errors', async () => {
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockRejectedValue(error)

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.deleteApiKey('key-123')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete API key', {
      providerId: 'openai',
      keyId: 'key-123',
      error
    })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('should log and rethrow updateAuthConfig errors', async () => {
    const error = new Error('Auth update failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    const authConfig = { authType: 'oauth' } as any
    await act(async () => {
      await expect(result.current.updateAuthConfig(authConfig)).rejects.toThrow('Auth update failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update auth config', { providerId: 'openai', error })
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

  it('should build correct path for hyphenated provider IDs', () => {
    renderHook(() => useProviderAuthConfig('vertexai-prod'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/vertexai-prod/auth-config')
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

  it('should build correct path for hyphenated provider IDs', () => {
    renderHook(() => useProviderApiKeys('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai-main/api-keys')
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

  it('should build correct path for hyphenated provider IDs', () => {
    renderHook(() => useProviderRegistryModels('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/openai-main/registry-models')
  })
})

describe('useProviderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build correct paths for dynamic provider actions', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.patch.mockResolvedValue({})
    mockDataApiService.delete.mockResolvedValue({})

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await result.current.patchProviderById('openai-main', { isEnabled: false })
      await result.current.deleteProviderById('openai-main')
    })

    expect(mockDataApiService.patch).toHaveBeenCalledWith('/providers/openai-main', {
      body: { isEnabled: false }
    })
    expect(mockDataApiService.delete).toHaveBeenCalledWith('/providers/openai-main')
    expect(mockInvalidate).toHaveBeenCalledWith('/providers')
  })

  it('should log and rethrow patchProviderById errors', async () => {
    const error = new Error('Patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.patch.mockRejectedValue(error)

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await expect(result.current.patchProviderById('openai', { isEnabled: false })).rejects.toThrow('Patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to patch provider', { providerId: 'openai', error })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('should log and rethrow deleteProviderById errors', async () => {
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockRejectedValue(error)

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await expect(result.current.deleteProviderById('openai')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete provider', { providerId: 'openai', error })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})
