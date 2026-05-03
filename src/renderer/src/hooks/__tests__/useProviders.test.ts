import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
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

  it('should keep the empty fallback array reference stable across rerenders', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useProviders())
    const firstProviders = result.current.providers

    rerender()

    expect(result.current.providers).toBe(firstProviders)
  })

  it('should call useQuery with /providers path', () => {
    renderHook(() => useProviders())

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', undefined)
  })

  it('should pass enabled query option when provided', () => {
    renderHook(() => useProviders({ enabled: false }))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', { query: { enabled: false } })
  })

  it('should filter undefined query fields before passing to useQuery', () => {
    renderHook(() => useProviders({ enabled: undefined as any }))

    // undefined values stripped — no query object passed
    expect(mockUseQuery).toHaveBeenCalledWith('/providers', undefined)
  })

  it('should disable SWR request when fetchEnabled is false', () => {
    renderHook(() => useProviders(undefined, { fetchEnabled: false }))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', { enabled: false })
  })

  it('should pass query params AND control SWR independently', () => {
    renderHook(() => useProviders({ enabled: false }, { fetchEnabled: true }))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers', {
      query: { enabled: false },
      enabled: true
    })
  })

  it('should call useMutation for POST /providers', () => {
    renderHook(() => useProviders())

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/providers', {
      refresh: ['/providers']
    })
  })

  it('should call createTrigger when createProvider is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ id: 'new-provider' })
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviders())

    const dto = { providerId: 'new-provider', name: 'New Provider' }
    await act(async () => {
      await result.current.createProvider(dto)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: dto })
  })

  it('should log and rethrow createProvider errors', async () => {
    const error = new Error('Create failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviders())

    await act(async () => {
      await expect(result.current.createProvider({ providerId: 'new', name: 'New' })).rejects.toThrow('Create failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to create provider', { providerId: 'new', error })
  })

  it('should expose refetch from useQuery', () => {
    const mockRefetch = vi.fn()
    mockUseQuery.mockImplementation(() => ({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: mockRefetch,
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.refetch).toBe(mockRefetch)
  })

  it('should expose create mutation loading and error state', () => {
    const mockError = new Error('Create mutation failed')
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'POST' && path === '/providers',
      error: _method === 'POST' && path === '/providers' ? mockError : undefined
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.isCreating).toBe(true)
    expect(result.current.createError).toBe(mockError)
  })
})

describe('useProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query single provider by ID', () => {
    mockUseQuery.mockImplementation(() => ({
      data: mockProvider1,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.provider).toEqual(mockProvider1)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId', { params: { providerId: 'openai' } })
  })

  it('should build correct params for hyphenated provider IDs', () => {
    renderHook(() => useProvider('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId', { params: { providerId: 'openai-main' } })
  })

  it('should expose error and refetch from useQuery', () => {
    const mockError = new Error('Load failed')
    const mockRefetch = vi.fn()
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: mockError,
      refetch: mockRefetch,
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.error).toBe(mockError)
    expect(result.current.refetch).toBe(mockRefetch)
  })

  it('should include mutation functions', () => {
    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.updateProvider).toBeDefined()
    expect(result.current.deleteProvider).toBeDefined()
    expect(result.current.updateAuthConfig).toBeDefined()
    expect(result.current.updateApiKeys).toBeDefined()
    expect(result.current.addApiKey).toBeDefined()
    expect(result.current.deleteApiKey).toBeDefined()
  })
})

describe('useProviderMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set up PATCH and DELETE mutations via template path with list + entity + /* wildcard refresh', () => {
    renderHook(() => useProviderMutations('openai'))

    const patchCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'PATCH' && c[1] === '/providers/:providerId'
    )
    const deleteCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'DELETE' && c[1] === '/providers/:providerId'
    )

    expect(patchCall).toBeDefined()
    // P0: list + entity + /* wildcard covers useProvider(id) and all sub-resource hooks
    expect(patchCall![2]).toEqual({ refresh: ['/providers', '/providers/openai', '/providers/openai/*'] })

    expect(deleteCall).toBeDefined()
    expect(deleteCall![2]).toEqual({ refresh: ['/providers', '/providers/openai', '/providers/openai/*'] })
  })

  it('should set up POST api-keys mutation with /* wildcard refresh', () => {
    renderHook(() => useProviderMutations('openai'))

    const addKeyCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'POST' && c[1] === '/providers/:providerId/api-keys'
    )

    expect(addKeyCall).toBeDefined()
    // /* wildcard covers api-keys sub-path declaratively; no explicit sub-path needed
    expect(addKeyCall![2]).toEqual({
      refresh: ['/providers', '/providers/openai', '/providers/openai/*']
    })
  })

  it('should set up DELETE api-key mutation with /* wildcard refresh', () => {
    renderHook(() => useProviderMutations('openai'))

    const deleteKeyCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'DELETE' && c[1] === '/providers/:providerId/api-keys/:keyId'
    )

    expect(deleteKeyCall).toBeDefined()
    expect(deleteKeyCall![2]).toEqual({
      refresh: ['/providers', '/providers/openai', '/providers/openai/*']
    })
  })

  it('should build correct refresh paths for hyphenated provider IDs', () => {
    renderHook(() => useProviderMutations('openai-main'))

    const patchCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'PATCH' && c[1] === '/providers/:providerId'
    )

    expect(patchCall).toBeDefined()
    expect(patchCall![2]).toEqual({
      refresh: ['/providers', '/providers/openai-main', '/providers/openai-main/*']
    })
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

    expect(mockTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' }, body: { isEnabled: false } })
  })

  it('should call deleteTrigger with providerId param when deleteProvider is invoked', async () => {
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

    expect(mockTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' } })
  })

  it('should patch authConfig via patchTrigger — /* wildcard covers sub-path, no manual invalidate', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    const authConfig = { authType: 'api-key' } as any
    await act(async () => {
      await result.current.updateAuthConfig(authConfig)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' }, body: { authConfig } })
  })

  it('should update API keys via patchTrigger — /* wildcard covers sub-path, no manual invalidate', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    const apiKeys = [{ id: 'k1', key: 'sk-test', isEnabled: true }] as any
    await act(async () => {
      await result.current.updateApiKeys(apiKeys)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' }, body: { apiKeys } })
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

  it('should call addApiKey trigger with providerId param and body', async () => {
    const addKeyTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'POST' && path === '/providers/:providerId/api-keys'
          ? addKeyTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.addApiKey('sk-test-key', 'My Key')
    })

    expect(addKeyTrigger).toHaveBeenCalledWith({
      params: { providerId: 'openai' },
      body: { key: 'sk-test-key', label: 'My Key' }
    })
  })

  it('should build correct addApiKey params for hyphenated provider IDs', async () => {
    const addKeyTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'POST' && path === '/providers/:providerId/api-keys'
          ? addKeyTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai-main'))

    await act(async () => {
      await result.current.addApiKey('sk-test-key', 'My Key')
    })

    expect(addKeyTrigger).toHaveBeenCalledWith({
      params: { providerId: 'openai-main' },
      body: { key: 'sk-test-key', label: 'My Key' }
    })
  })

  it('should call deleteApiKey trigger with providerId and keyId params', async () => {
    const deleteKeyTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'DELETE' && path === '/providers/:providerId/api-keys/:keyId'
          ? deleteKeyTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.deleteApiKey('key-123')
    })

    expect(deleteKeyTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai', keyId: 'key-123' } })
  })

  it('should build correct deleteApiKey params for hyphenated provider IDs', async () => {
    const deleteKeyTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'DELETE' && path === '/providers/:providerId/api-keys/:keyId'
          ? deleteKeyTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai-main'))

    await act(async () => {
      await result.current.deleteApiKey('key-456')
    })

    expect(deleteKeyTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai-main', keyId: 'key-456' } })
  })

  it('should log and rethrow addApiKey errors', async () => {
    const error = new Error('Post failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'POST' && path === '/providers/:providerId/api-keys'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.addApiKey('sk-test')).rejects.toThrow('Post failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to add API key', { providerId: 'openai', error })
  })

  it('should log and rethrow deleteApiKey errors', async () => {
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'DELETE' && path === '/providers/:providerId/api-keys/:keyId'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.deleteApiKey('key-123')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete API key', {
      providerId: 'openai',
      keyId: 'key-123',
      error
    })
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

  it('should log and rethrow updateApiKeys errors', async () => {
    const error = new Error('API key update failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(
        result.current.updateApiKeys([{ id: 'k1', key: 'sk-test', isEnabled: true } as any])
      ).rejects.toThrow('API key update failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update API keys', { providerId: 'openai', error })
  })

  it('should expose isUpdating and isDeleting loading states', () => {
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'PATCH' && path === '/providers/:providerId',
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    expect(result.current.isUpdating).toBe(true)
    expect(result.current.isDeleting).toBe(false)
  })

  it('should expose isAddingApiKey and isDeletingApiKey loading states', () => {
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'POST' && path === '/providers/:providerId/api-keys',
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    expect(result.current.isAddingApiKey).toBe(true)
    expect(result.current.isDeletingApiKey).toBe(false)
  })

  it('should expose addApiKeyError and deleteApiKeyError', () => {
    const mockError = new Error('Key error')
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: false,
      error: _method === 'POST' && path === '/providers/:providerId/api-keys' ? mockError : undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    expect(result.current.addApiKeyError).toBe(mockError)
    expect(result.current.deleteApiKeyError).toBeUndefined()
  })
})

describe('useProviderActions refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should compute refresh paths from trigger args — no fallback branch', () => {
    renderHook(() => useProviderActions())

    const patchCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'PATCH' && c[1] === '/providers/:providerId'
    )
    expect(patchCall).toBeDefined()

    // Invoke the function-form refresh with real args to confirm it calls providerRefreshPaths
    const refreshFn = (patchCall as any[])[2].refresh as (ctx: { args: { params: { providerId: string } } }) => string[]
    const result = refreshFn({ args: { params: { providerId: 'openai' } } })
    expect(result).toEqual(['/providers', '/providers/openai', '/providers/openai/*'])
  })
})

describe('useProviderAuthConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query auth config for a provider', () => {
    const mockAuthConfig = { authType: 'oauth' } as any
    mockUseQuery.mockImplementation(() => ({
      data: mockAuthConfig,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderAuthConfig('vertexai'))

    expect(result.current.data).toEqual(mockAuthConfig)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/auth-config', {
      params: { providerId: 'vertexai' }
    })
  })

  it('should build correct params for hyphenated provider IDs', () => {
    renderHook(() => useProviderAuthConfig('vertexai-prod'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/auth-config', {
      params: { providerId: 'vertexai-prod' }
    })
  })
})

describe('useProviderApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query API keys for a provider', () => {
    const mockKeys = { keys: [{ id: 'k1', key: 'sk-xxx', isEnabled: true }] }
    mockUseQuery.mockImplementation(() => ({
      data: mockKeys,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderApiKeys('openai'))

    expect(result.current.data).toEqual(mockKeys)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/api-keys', { params: { providerId: 'openai' } })
  })

  it('should build correct params for hyphenated provider IDs', () => {
    renderHook(() => useProviderApiKeys('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/api-keys', {
      params: { providerId: 'openai-main' }
    })
  })
})

describe('useProviderRegistryModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should query registry models for a provider', () => {
    const mockModels = [{ id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai' }]
    mockUseQuery.mockImplementation(() => ({
      data: mockModels,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderRegistryModels('openai'))

    expect(result.current.data).toEqual(mockModels)
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/registry-models', {
      params: { providerId: 'openai' }
    })
  })

  it('should build correct params for hyphenated provider IDs', () => {
    renderHook(() => useProviderRegistryModels('openai-main'))

    expect(mockUseQuery).toHaveBeenCalledWith('/providers/:providerId/registry-models', {
      params: { providerId: 'openai-main' }
    })
  })
})

describe('useProviderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set up template-path PATCH and DELETE mutations', () => {
    renderHook(() => useProviderActions())

    const patchCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'PATCH' && c[1] === '/providers/:providerId'
    )
    const deleteCall = mockUseMutation.mock.calls.find(
      (c: any[]) => c[0] === 'DELETE' && c[1] === '/providers/:providerId'
    )

    expect(patchCall).toBeDefined()
    expect(deleteCall).toBeDefined()
  })

  it('should call updateTrigger with providerId param and body', async () => {
    const updateTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: _method === 'PATCH' && path === '/providers/:providerId' ? updateTrigger : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await result.current.updateProviderById('openai-main', { isEnabled: false })
    })

    expect(updateTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai-main' }, body: { isEnabled: false } })
  })

  it('should call deleteTrigger with providerId param', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'DELETE' && path === '/providers/:providerId' ? deleteTrigger : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await result.current.deleteProviderById('openai-main')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai-main' } })
  })

  it('should log and rethrow updateProviderById errors', async () => {
    const error = new Error('Patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PATCH' && path === '/providers/:providerId'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await expect(result.current.updateProviderById('openai', { isEnabled: false })).rejects.toThrow('Patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update provider', { providerId: 'openai', error })
  })

  it('should log and rethrow deleteProviderById errors', async () => {
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'DELETE' && path === '/providers/:providerId'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderActions())

    await act(async () => {
      await expect(result.current.deleteProviderById('openai')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete provider', { providerId: 'openai', error })
  })
})
