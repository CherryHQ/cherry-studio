import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getProviderDisplayName,
  useProvider,
  useProviderActions,
  useProviderApiKeys,
  useProviderAuthConfig,
  useProviderDisplayName,
  useProviderMutations,
  useProviderPreset,
  useProviders
} from '../useProvider'

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

describe('useProviderPreset', () => {
  it('revalidates registry-backed model projections after a snapshot update', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockReturnValue({
      data: { models: [] },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch,
      mutate: vi.fn()
    })
    renderHook(() => useProviderPreset('openai', ['models']))

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/providers/:providerId/preset' }])

    expect(refetch).toHaveBeenCalledOnce()
  })
})

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
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual(mockProviderList)
    expect(result.current.isLoading).toBe(false)
  })

  it('should return an empty array while loading', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual([])
    expect(result.current.isLoading).toBe(true)

    rerender()
  })

  it('exposes a provider list read failure instead of presenting only an empty list', () => {
    const error = new Error('Provider registry unavailable')
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual([])
    expect(result.current.hasLoaded).toBe(false)
    expect(result.current.error).toBe(error)
  })

  it('marks stale provider data as loaded when background revalidation fails', () => {
    const error = new Error('Provider registry unavailable')
    mockUseQuery.mockReturnValue({
      data: mockProviderList,
      isLoading: false,
      isRefreshing: false,
      error,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useProviders())

    expect(result.current.providers).toEqual(mockProviderList)
    expect(result.current.hasLoaded).toBe(true)
    expect(result.current.error).toBe(error)
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
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviders())

    await act(async () => {
      await expect(result.current.createProvider({ providerId: 'new', name: 'New' })).rejects.toThrow('Create failed')
    })
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
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProvider('openai'))

    expect(result.current.provider).toEqual(mockProvider1)
    expect(result.current.isLoading).toBe(false)
  })

  it('should expose error and refetch from useQuery', () => {
    const mockError = new Error('Load failed')
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
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
  })
})

describe('useProviderMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should enable a provider through the generic PATCH mutation', async () => {
    const patchTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PATCH' && path === '/providers/:providerId' ? patchTrigger : vi.fn().mockResolvedValue(undefined),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.enableProvider()
    })

    expect(patchTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' }, body: { isEnabled: true } })
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

  it('should update API keys via dedicated PUT api-keys resource', async () => {
    const replaceKeysTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PUT' && path === '/providers/:providerId/api-keys'
          ? replaceKeysTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    const apiKeys = [{ id: 'k1', key: 'sk-test', isEnabled: true }] as any
    await act(async () => {
      await result.current.updateApiKeys(apiKeys)
    })

    expect(replaceKeysTrigger).toHaveBeenCalledWith({ params: { providerId: 'openai' }, body: { keys: apiKeys } })
  })

  it('should log and rethrow updateProvider errors', async () => {
    const error = new Error('Patch failed')
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.updateProvider({ isEnabled: false })).rejects.toThrow('Patch failed')
    })
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
    const apiKey = 'sk-should-not-reach-logs'
    const error = new Error(`Post failed for ${apiKey}`)
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
      await expect(result.current.addApiKey(apiKey)).rejects.toThrow(`Post failed for ${apiKey}`)
    })
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(apiKey)
  })

  it('should log and rethrow deleteApiKey errors', async () => {
    const error = new Error('Delete failed')
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
  })

  it('should log and rethrow updateAuthConfig errors', async () => {
    const error = new Error('Auth update failed')
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
  })

  it('should log and rethrow updateApiKeys errors', async () => {
    const apiKey = 'sk-should-not-reach-logs'
    const error = new Error(`API key update failed for ${apiKey}`)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PUT' && path === '/providers/:providerId/api-keys'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.updateApiKeys([{ id: 'k1', key: apiKey, isEnabled: true } as any])).rejects.toThrow(
        `API key update failed for ${apiKey}`
      )
    })
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(apiKey)
  })

  it('should call updateApiKey trigger with providerId, keyId and body', async () => {
    const updateKeyTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PATCH' && path === '/providers/:providerId/api-keys/:keyId'
          ? updateKeyTrigger
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await result.current.updateApiKey('key-1', { label: 'Primary', isEnabled: false })
    })

    expect(updateKeyTrigger).toHaveBeenCalledWith({
      params: { providerId: 'openai', keyId: 'key-1' },
      body: { label: 'Primary', isEnabled: false }
    })
  })

  it('should not log a key echoed by an updateApiKey error', async () => {
    const apiKey = 'sk-should-not-reach-logs'
    const error = new Error(`API key update failed for ${apiKey}`)
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger:
        _method === 'PATCH' && path === '/providers/:providerId/api-keys/:keyId'
          ? vi.fn().mockRejectedValue(error)
          : vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useProviderMutations('openai'))

    await act(async () => {
      await expect(result.current.updateApiKey('key-1', { key: apiKey })).rejects.toThrow(
        `API key update failed for ${apiKey}`
      )
    })
    expect(JSON.stringify(loggerSpy.mock.calls)).not.toContain(apiKey)
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
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderAuthConfig('vertexai'))

    expect(result.current.data).toEqual(mockAuthConfig)
    expect(result.current.isLoading).toBe(false)
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
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderApiKeys('openai'))

    expect(result.current.data).toEqual(mockKeys)
    expect(result.current.isLoading).toBe(false)
  })
})

describe('useProviderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('should log and rethrow deleteProviderById errors', async () => {
    const error = new Error('Delete failed')
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
  })
})

describe('getProviderDisplayName', () => {
  it('returns empty string when provider is undefined', () => {
    expect(getProviderDisplayName(undefined)).toBe('')
  })

  it('returns provider.name for non-system provider ids', () => {
    expect(getProviderDisplayName({ id: 'my-custom', name: 'My Custom' } as any)).toBe('My Custom')
  })
})

describe('useProviderDisplayName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty string when providerId is undefined', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderDisplayName(undefined))
    expect(result.current).toBe('')
  })

  it('returns provider.name for non-system provider', () => {
    mockUseQuery.mockImplementation(() => ({
      data: { id: 'my-custom', name: 'My Custom' },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useProviderDisplayName('my-custom'))
    expect(result.current).toBe('My Custom')
  })
})
