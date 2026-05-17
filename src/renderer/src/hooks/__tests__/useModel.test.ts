import type { BulkUpdateModelItem } from '@shared/data/api/schemas/models'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../tests/__mocks__/RendererLoggerService'
import { useModelMutations, useModels } from '../useModel'

// ─── Mock data ────────────────────────────────────────────────────────
const mockModel1: any = {
  id: 'openai::gpt-4o',
  providerId: 'openai',
  modelId: 'gpt-4o',
  name: 'GPT-4o',
  isEnabled: true
}

const mockModel2: any = {
  id: 'anthropic::claude-3-opus',
  providerId: 'anthropic',
  modelId: 'claude-3-opus',
  name: 'Claude 3 Opus',
  isEnabled: true
}

const mockModelList = [mockModel1, mockModel2]

describe('useModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return models array from useQuery', () => {
    mockUseQuery.mockImplementation(() => ({
      data: mockModelList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useModels())

    expect(result.current.models).toEqual(mockModelList)
    expect(result.current.isLoading).toBe(false)
  })

  it('should return empty array when data is undefined', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useModels())

    expect(result.current.models).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('should keep the empty fallback array reference stable across rerenders', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useModels())
    const firstModels = result.current.models

    rerender()

    expect(result.current.models).toBe(firstModels)
  })

  it('should call useQuery with /models path and no query when no args', () => {
    renderHook(() => useModels())

    expect(mockUseQuery).toHaveBeenCalledWith('/models', undefined)
  })

  it('should pass providerId as query parameter', () => {
    renderHook(() => useModels({ providerId: 'openai' }))

    expect(mockUseQuery).toHaveBeenCalledWith('/models', { query: { providerId: 'openai' } })
  })

  it('should pass enabled as a query parameter for filtering', () => {
    renderHook(() => useModels({ enabled: false }))

    expect(mockUseQuery).toHaveBeenCalledWith('/models', { query: { enabled: false } })
  })

  it('should pass both providerId and enabled as query parameters', () => {
    renderHook(() => useModels({ providerId: 'openai', enabled: true }))

    expect(mockUseQuery).toHaveBeenCalledWith('/models', {
      query: { providerId: 'openai', enabled: true }
    })
  })

  it('should pass capability from the shared ListModelsQuery contract', () => {
    renderHook(() => useModels({ providerId: 'openai', capability: MODEL_CAPABILITY.REASONING }))

    expect(mockUseQuery).toHaveBeenCalledWith('/models', {
      query: { providerId: 'openai', capability: MODEL_CAPABILITY.REASONING }
    })
  })

  it('should disable SWR request when fetchEnabled is false', () => {
    renderHook(() => useModels(undefined, { fetchEnabled: false }))
    expect(mockUseQuery).toHaveBeenCalledWith('/models', { enabled: false })
  })

  it('should pass query params AND control SWR independently', () => {
    renderHook(() => useModels({ providerId: 'openai', enabled: false }, { fetchEnabled: true }))
    expect(mockUseQuery).toHaveBeenCalledWith('/models', {
      query: { providerId: 'openai', enabled: false },
      enabled: true
    })
  })

  it('should expose refetch from useQuery', () => {
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockImplementation(() => ({
      data: mockModelList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: mockRefetch,
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useModels())

    expect(result.current.refetch).toBe(mockRefetch)
  })
})

describe('useModelMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set up POST, DELETE, single PATCH, and bulk PATCH mutations', () => {
    renderHook(() => useModelMutations())

    const calls = mockUseMutation.mock.calls
    expect(calls.find((c: any[]) => c[0] === 'POST' && c[1] === '/models')).toBeDefined()
    expect(calls.find((c: any[]) => c[0] === 'DELETE' && c[1] === '/models/:uniqueModelId*')).toBeDefined()
    expect(calls.find((c: any[]) => c[0] === 'PATCH' && c[1] === '/models/:uniqueModelId*')).toBeDefined()
    expect(calls.find((c: any[]) => c[0] === 'PATCH' && c[1] === '/models')).toBeDefined()
    expect(mockUseMutation).toHaveBeenCalledTimes(4)
  })

  it('should configure all mutations to refresh /models', () => {
    renderHook(() => useModelMutations())

    for (const call of mockUseMutation.mock.calls as any[][]) {
      expect(call[2]).toMatchObject({ refresh: ['/models'] })
    }
  })

  it('should call createTrigger with a single-item array when createModel is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue([{ id: 'new-model' }])
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const dto = { providerId: 'openai', modelId: 'gpt-5' }
    await act(async () => {
      await result.current.createModel(dto)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: [dto] })
  })

  it('should log and rethrow createModel errors', async () => {
    const error = new Error('Create failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.createModel({ providerId: 'openai', modelId: 'gpt-5' })).rejects.toThrow(
        'Create failed'
      )
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to create model', {
      providerId: 'openai',
      modelId: 'gpt-5',
      error
    })
  })

  it('should unwrap the first created model from the array response', async () => {
    const mockTrigger = vi.fn().mockResolvedValue([{ id: 'new-model' }])
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const dto = { providerId: 'openai', modelId: 'gpt-5' }
    let created: any
    await act(async () => {
      created = await result.current.createModel(dto)
    })

    expect(created).toEqual({ id: 'new-model' })
  })

  it('should return undefined when createModel receives an empty array response', async () => {
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockResolvedValue([]),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    let created: any
    await act(async () => {
      created = await result.current.createModel({ providerId: 'openai', modelId: 'gpt-5' })
    })

    expect(created).toBeUndefined()
  })

  it('should call create trigger with the full array when createModels is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue([{ id: 'batch-model-1' }, { id: 'batch-model-2' }])
    mockUseMutation.mockImplementation(() => ({
      trigger: mockTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items = [
      { providerId: 'openai', modelId: 'gpt-5' },
      { providerId: 'openai', modelId: 'gpt-5-mini' }
    ]
    await act(async () => {
      await result.current.createModels(items)
    })

    expect(mockTrigger).toHaveBeenCalledWith({ body: items })
  })

  it('should log and rethrow createModels errors', async () => {
    const error = new Error('Batch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation(() => ({
      trigger: vi.fn().mockRejectedValue(error),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items = [{ providerId: 'openai', modelId: 'gpt-5' }]
    await act(async () => {
      await expect(result.current.createModels(items)).rejects.toThrow('Batch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to create models', { count: 1, error })
  })

  it('should call DELETE mutation trigger with uniqueModelId param when deleteModel is invoked', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? deleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('openai', 'gpt-4o')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { uniqueModelId: 'openai::gpt-4o' } })
  })

  it('should call PATCH mutation trigger with uniqueModelId param and body when updateModel is invoked', async () => {
    const updateTrigger = vi.fn().mockResolvedValue({})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'PATCH' ? updateTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.updateModel('openai', 'gpt-4o', { isEnabled: false })
    })

    expect(updateTrigger).toHaveBeenCalledWith({
      params: { uniqueModelId: 'openai::gpt-4o' },
      body: { isEnabled: false }
    })
  })

  it('should call bulk PATCH mutation trigger with the full item array when updateModels is invoked', async () => {
    const bulkUpdateTrigger = vi.fn().mockResolvedValue([])
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' && _method === 'PATCH' ? bulkUpdateTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items: BulkUpdateModelItem[] = [
      { uniqueModelId: 'openai::gpt-4o', patch: { isEnabled: false } },
      { uniqueModelId: 'openai::gpt-4o-mini', patch: { isEnabled: true } }
    ]
    await act(async () => {
      await result.current.updateModels(items)
    })

    expect(bulkUpdateTrigger).toHaveBeenCalledWith({ body: items })
  })

  it('should log and rethrow deleteModel errors', async () => {
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.deleteModel('openai', 'gpt-4o')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete model', {
      providerId: 'openai',
      modelId: 'gpt-4o',
      error
    })
  })

  it('should log and rethrow updateModel errors', async () => {
    const error = new Error('Patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'PATCH' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.updateModel('openai', 'gpt-4o', { isEnabled: false })).rejects.toThrow('Patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update model', {
      providerId: 'openai',
      modelId: 'gpt-4o',
      error
    })
  })

  it('should log and rethrow updateModels errors', async () => {
    const error = new Error('Bulk patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' && _method === 'PATCH' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items: BulkUpdateModelItem[] = [{ uniqueModelId: 'openai::gpt-4o', patch: { isEnabled: false } }]
    await act(async () => {
      await expect(result.current.updateModels(items)).rejects.toThrow('Bulk patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to bulk update models', { count: 1, error })
  })

  it('should build uniqueModelId param correctly for simple IDs', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? deleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('anthropic', 'claude-3-opus')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { uniqueModelId: 'anthropic::claude-3-opus' } })
  })

  it('should build uniqueModelId param correctly for model IDs containing slashes', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? deleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('cherryin', 'qwen/qwen3-vl-30b-a3b-thinking(free)')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({
      params: { uniqueModelId: 'cherryin::qwen/qwen3-vl-30b-a3b-thinking(free)' }
    })
  })

  it.each(['?', '#'])('should reject model IDs containing reserved route character %s', async (char) => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? deleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.deleteModel('openai', `gpt-5${char}preview`)).rejects.toThrow(
        `modelId cannot contain reserved route character "${char}"`
      )
    })

    expect(deleteTrigger).not.toHaveBeenCalled()
  })

  it('should expose mutation loading states', () => {
    mockUseMutation.mockImplementation((_method: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'POST',
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    expect(result.current.isCreating).toBe(true)
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.isUpdating).toBe(false)
    expect(result.current.isBulkUpdating).toBe(false)
  })
})
