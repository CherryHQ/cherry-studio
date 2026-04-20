import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { mockUseInvalidateCache, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../tests/__mocks__/RendererLoggerService'
import { useModelMutations, useModels } from '../useModels'

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
      refetch: vi.fn(),
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
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useModels())

    expect(result.current.models).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('should call useQuery with /models path and no query when no args', () => {
    renderHook(() => useModels())

    expect(mockUseQuery).toHaveBeenCalledWith('/models', {})
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

  it('should expose refetch from mutate', () => {
    const mockMutate = vi.fn()
    mockUseQuery.mockImplementation(() => ({
      data: mockModelList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: mockMutate
    }))

    const { result } = renderHook(() => useModels())

    expect(result.current.refetch).toBe(mockMutate)
  })
})

describe('useModelMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set up POST mutation for /models', () => {
    renderHook(() => useModelMutations())

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/models', {
      refresh: ['/models']
    })
    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/models/batch', {
      refresh: ['/models']
    })
  })

  it('should call createTrigger when createModel is invoked', async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ id: 'new-model' })
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

    expect(mockTrigger).toHaveBeenCalledWith({ body: dto })
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

  it('should call batch create trigger when createModelsBatch is invoked', async () => {
    const singleTrigger = vi.fn().mockResolvedValue({ id: 'single-model' })
    const batchTrigger = vi.fn().mockResolvedValue([{ id: 'batch-model-1' }, { id: 'batch-model-2' }])
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/batch' ? batchTrigger : singleTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items = [
      { providerId: 'openai', modelId: 'gpt-5' },
      { providerId: 'openai', modelId: 'gpt-5-mini' }
    ]
    await act(async () => {
      await result.current.createModelsBatch(items)
    })

    expect(batchTrigger).toHaveBeenCalledWith({ body: { items } })
    expect(singleTrigger).not.toHaveBeenCalled()
  })

  it('should log and rethrow createModelsBatch errors', async () => {
    const error = new Error('Batch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/batch' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const items = [{ providerId: 'openai', modelId: 'gpt-5' }]
    await act(async () => {
      await expect(result.current.createModelsBatch(items)).rejects.toThrow('Batch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to create model batch', { count: 1, error })
  })

  it('should log and rethrow updateModel errors', async () => {
    const error = new Error('Patch failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.patch.mockRejectedValue(error)

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.updateModel('openai', 'gpt-4o', { isEnabled: false })).rejects.toThrow('Patch failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to update model', {
      providerId: 'openai',
      modelId: 'gpt-4o',
      error
    })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('should delete model via dataApiService and invalidate cache', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockResolvedValue({ deleted: true })

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('openai', 'gpt-4o')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/models/openai::gpt-4o')
    expect(mockInvalidate).toHaveBeenCalledWith('/models')
  })

  it('should update model via dataApiService and invalidate cache', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.patch.mockResolvedValue({})

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.updateModel('openai', 'gpt-4o', { isEnabled: false })
    })

    expect(mockDataApiService.patch).toHaveBeenCalledWith('/models/openai::gpt-4o', {
      body: { isEnabled: false }
    })
    expect(mockInvalidate).toHaveBeenCalledWith('/models')
  })

  it('should log and rethrow deleteModel errors', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    const error = new Error('Delete failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockRejectedValue(error)

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.deleteModel('openai', 'gpt-4o')).rejects.toThrow('Delete failed')
    })

    expect(loggerSpy).toHaveBeenCalledWith('Failed to delete model', {
      providerId: 'openai',
      modelId: 'gpt-4o',
      error
    })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('should build uniqueModelId path correctly', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockResolvedValue({ deleted: true })

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('anthropic', 'claude-3-opus')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/models/anthropic::claude-3-opus')
  })

  it('should handle model IDs that contain slashes via uniqueModelId format', async () => {
    const mockInvalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockImplementation(() => mockInvalidate)
    mockDataApiService.delete.mockResolvedValue({ deleted: true })

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await result.current.deleteModel('cherryin', 'qwen/qwen3-vl-30b-a3b-thinking(free)')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/models/cherryin::qwen/qwen3-vl-30b-a3b-thinking(free)')
  })
})
