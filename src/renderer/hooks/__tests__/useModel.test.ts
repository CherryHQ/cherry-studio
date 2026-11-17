import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BulkUpdateModelItem } from '@shared/data/api/schemas/models'
import { type UniqueModelId } from '@shared/data/types/model'

import { useDefaultModel, useModelById, useModelMutations, useModels } from '../useModel'

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

  it('should return an empty array while loading', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useModels())

    expect(result.current.models).toEqual([])
    expect(result.current.isLoading).toBe(true)

    rerender()
  })

  it('revalidates mounted model lists after registry metadata changes', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockReturnValue({
      data: mockModelList,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch,
      mutate: vi.fn()
    })
    renderHook(() => useModels())

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/models', kind: 'projection' }])

    expect(refetch).toHaveBeenCalledOnce()
  })
})

describe('useModelById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('revalidates a mounted model after registry enrichment changes', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockReturnValue({
      data: mockModel1,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch,
      mutate: vi.fn()
    })
    renderHook(() => useModelById('openai::gpt-4o'))

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/models/:uniqueModelId*' }])

    expect(refetch).toHaveBeenCalledOnce()
  })
})

describe('useModelMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should call bulk DELETE mutation trigger with query ids when deleteModels is invoked', async () => {
    const bulkDeleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' && _method === 'DELETE' ? bulkDeleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const ids = ['openai::gpt-4o', 'openai::gpt-4o-mini'] as UniqueModelId[]
    await act(async () => {
      await result.current.deleteModels(ids)
    })

    expect(bulkDeleteTrigger).toHaveBeenCalledWith({ query: { ids } })
  })

  it('should preserve commas inside model ids when deleteModels is invoked', async () => {
    const bulkDeleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' && _method === 'DELETE' ? bulkDeleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const ids = ['openai::model,with-comma'] as UniqueModelId[]
    await act(async () => {
      await result.current.deleteModels(ids)
    })

    expect(bulkDeleteTrigger).toHaveBeenCalledWith({ query: { ids } })
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
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'DELETE' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.deleteModel('openai', 'gpt-4o')).rejects.toThrow('Delete failed')
    })
  })

  it('should log and rethrow updateModel errors', async () => {
    const error = new Error('Patch failed')
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models/:uniqueModelId*' && _method === 'PATCH' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    await act(async () => {
      await expect(result.current.updateModel('openai', 'gpt-4o', { isEnabled: false })).rejects.toThrow('Patch failed')
    })
  })

  it('should log and rethrow updateModels errors', async () => {
    const error = new Error('Bulk patch failed')
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
  })

  it('should log and rethrow deleteModels errors', async () => {
    const error = new Error('Bulk delete failed')
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/models' && _method === 'DELETE' ? vi.fn().mockRejectedValue(error) : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    const ids = ['openai::gpt-4o'] as UniqueModelId[]
    await act(async () => {
      await expect(result.current.deleteModels(ids)).rejects.toThrow('Bulk delete failed')
    })
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
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'POST' && path === '/models',
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    expect(result.current.isCreating).toBe(true)
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.isBulkDeleting).toBe(false)
    expect(result.current.isUpdating).toBe(false)
    expect(result.current.isBulkUpdating).toBe(false)
  })

  it('should expose bulk delete loading state', () => {
    mockUseMutation.mockImplementation((_method: string, path: string) => ({
      trigger: vi.fn(),
      isLoading: _method === 'DELETE' && path === '/models',
      error: undefined
    }))

    const { result } = renderHook(() => useModelMutations())

    expect(result.current.isCreating).toBe(false)
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.isBulkDeleting).toBe(true)
    expect(result.current.isUpdating).toBe(false)
    expect(result.current.isBulkUpdating).toBe(false)
  })
})

describe('useDefaultModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))
  })

  it('reports an in-flight default model separately from a settled miss', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'openai::quick')
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::translate')
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', 'openai::dall-e-3')
    mockUseQuery.mockImplementation((path: string) => ({
      data: undefined,
      isLoading: path === '/models/openai::gpt-4o',
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useDefaultModel())

    expect(result.current.defaultModel).toBeUndefined()
    expect(result.current.isDefaultModelLoading).toBe(true)

    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))
    rerender()

    expect(result.current.defaultModel).toBeUndefined()
    expect(result.current.isDefaultModelLoading).toBe(false)
  })

  it('persists the picked painting model id to feature.paintings.default_model_id', async () => {
    const { result } = renderHook(() => useDefaultModel())

    await act(async () => {
      await result.current.setPaintingModel({ id: 'openai::dall-e-3' })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.paintings.default_model_id')).toBe('openai::dall-e-3')
  })

  // Unset means "execute an approved plan on the turn's current model", so it must never borrow
  // the chat default the way quick/translate do.
  it('does not fall back to the chat default when the plan execution model is unset', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'openai::quick')
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'openai::translate')
    MockUsePreferenceUtils.setPreferenceValue('chat.plan_execution.model_id', null)

    renderHook(() => useDefaultModel())

    // plan execution resolves the empty/disabled key, never the chat-default id
    expect(mockUseQuery).toHaveBeenCalledWith('/models/', { enabled: false, swrOptions: { keepPreviousData: false } })
    const defaultIdQueries = mockUseQuery.mock.calls.filter(([path]) => path === '/models/openai::gpt-4o')
    expect(defaultIdQueries).toHaveLength(1) // defaultModel only; plan execution did not borrow it
  })

  it('clears the plan execution model back to unset', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.plan_execution.model_id', 'openai::opus')
    const { result } = renderHook(() => useDefaultModel())

    await act(async () => {
      await result.current.setPlanExecutionModel(undefined)
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.plan_execution.model_id')).toBeNull()
  })

  it('cascades setDefaultModel to quick and translate but not painting', async () => {
    const { result } = renderHook(() => useDefaultModel())

    await act(async () => {
      await result.current.setDefaultModel({ id: 'openai::gpt-4o' })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.model_id')).toBe('openai::gpt-4o')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.model_id')).toBe('openai::gpt-4o')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.paintings.default_model_id')).toBeNull()
  })

  it('force-cascades setDefaultModel over existing quick and translate models', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'cherryai::quick')
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'cherryai::translate')
    const { result } = renderHook(() => useDefaultModel())

    await act(async () => {
      await result.current.setDefaultModel({ id: 'openai::gpt-4o' }, { forceCascade: true })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.model_id')).toBe('openai::gpt-4o')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.translate.model_id')).toBe('openai::gpt-4o')
  })
})
