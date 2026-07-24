import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { CreateKnowledgeBaseDto, KnowledgeBase, RestoreKnowledgeBaseResult } from '@shared/data/types/knowledge'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useEnableKnowledgeBaseEmbedding,
  useKnowledgeBases,
  useRestoreKnowledgeBase,
  useUpdateKnowledgeBase
} from '../useKnowledgeBase'

type CreateKnowledgeBaseInput = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId' | 'embeddingModelId' | 'dimensions'>

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockIpcRequest = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useInvalidateCache: () => mockUseInvalidateCache()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mockIpcRequest(...args)
  }
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  groupId: null,
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  documentCount: undefined,
  status: 'completed',
  error: null,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('useKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries the knowledge base list and returns flattened bases', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Base 1' }),
      createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
    ]
    const refetch = vi.fn()

    mockUseQuery.mockReturnValue({
      data: {
        items: bases,
        total: bases.length,
        page: 1
      },
      isLoading: false,
      error: undefined,
      refetch
    })

    const { result } = renderHook(() => useKnowledgeBases())

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases', {
      query: { page: 1, limit: 100 }
    })
    expect(result.current.bases).toEqual(bases)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.refetch).toBe(refetch)
  })

  it('returns an empty list when the query has no data yet', () => {
    const error = new Error('pending')
    const refetch = vi.fn()

    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error,
      refetch
    })

    const { result } = renderHook(() => useKnowledgeBases())

    expect(result.current.bases).toEqual([])
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBe(error)
    expect(result.current.refetch).toBe(refetch)
  })
})

describe('useCreateKnowledgeBase', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue(createKnowledgeBase())
  })

  it('creates a knowledge base with the selected group id through runtime IPC and refreshes the list', async () => {
    const createdBase = createKnowledgeBase({
      id: 'base-2',
      name: 'Base 2',
      groupId: 'group-2',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
    })
    mockIpcRequest.mockResolvedValueOnce(createdBase)
    const input: CreateKnowledgeBaseInput = {
      name: '  Base 2  ',
      groupId: 'group-2'
    }

    const { result } = renderHook(() => useCreateKnowledgeBase())
    let created: KnowledgeBase | undefined

    await act(async () => {
      created = await result.current.createBase(input)
    })

    expect(mockUseMutation).not.toHaveBeenCalled()
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.create_base', {
      base: {
        name: 'Base 2',
        groupId: 'group-2'
      }
    })
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases')
    expect(created).toEqual(createdBase)
    expect(result.current.isCreating).toBe(false)
    expect(result.current.createError).toBeUndefined()
  })

  it('omits groupId from the runtime IPC payload when the input stays ungrouped', async () => {
    const createdBase = createKnowledgeBase({
      id: 'base-3',
      name: 'Base 3',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    })
    mockIpcRequest.mockResolvedValueOnce(createdBase)
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 3'
    }

    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await result.current.createBase(input)
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.create_base', {
      base: {
        name: 'Base 3'
      }
    })
  })

  it('keeps create rejected when runtime IPC fails without refreshing the list', async () => {
    const createError = new Error('create failed')
    mockIpcRequest.mockRejectedValueOnce(createError)
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 4'
    }
    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await expect(result.current.createBase(input)).rejects.toBe(createError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.isCreating).toBe(false)
    expect(result.current.createError).toBe(createError)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to create knowledge base', createError, {
      name: 'Base 4',
      groupId: undefined
    })
  })

  it('passes the embedding model and dimensions together when both are provided', async () => {
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 5',
      embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      dimensions: LOCAL_EMBEDDING_DIMENSIONS
    }
    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await result.current.createBase(input)
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.create_base', {
      base: {
        name: 'Base 5',
        embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
        dimensions: LOCAL_EMBEDDING_DIMENSIONS
      }
    })
  })

  it('omits the embedding model from the runtime IPC payload when its dimensions are missing', async () => {
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 6',
      embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID
    }
    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await result.current.createBase(input)
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.create_base', {
      base: {
        name: 'Base 6'
      }
    })
  })
})

describe('useRestoreKnowledgeBase', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue(createKnowledgeBase())
  })

  it('restores a knowledge base through runtime IPC and refreshes the list', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      name: 'Legacy KB_bak',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1024
    })
    mockIpcRequest.mockResolvedValueOnce({ base: restoredBase, skippedMissingSourceCount: 0 })

    const { result } = renderHook(() => useRestoreKnowledgeBase())
    let restored: RestoreKnowledgeBaseResult | undefined

    await act(async () => {
      restored = await result.current.restoreBase({
        sourceBaseId: '  source-base  ',
        name: '  Legacy KB_bak  ',
        embeddingModelId: '  openai::text-embedding-3-small  ',
        dimensions: 1024
      })
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.restore_base', {
      sourceBaseId: 'source-base',
      name: 'Legacy KB_bak',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1024
    })
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases')
    expect(restored).toEqual({ base: restoredBase, skippedMissingSourceCount: 0 })
    expect(result.current.isRestoring).toBe(false)
    expect(result.current.restoreError).toBeUndefined()
  })

  it('keeps restore rejected when runtime IPC fails without refreshing the list', async () => {
    const restoreError = new Error('restore failed')
    mockIpcRequest.mockRejectedValueOnce(restoreError)
    const { result } = renderHook(() => useRestoreKnowledgeBase())

    await act(async () => {
      await expect(
        result.current.restoreBase({
          sourceBaseId: 'source-base',
          name: 'Legacy KB_bak',
          embeddingModelId: 'openai::text-embedding-3-small',
          dimensions: 1024
        })
      ).rejects.toBe(restoreError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.isRestoring).toBe(false)
    expect(result.current.restoreError).toBe(restoreError)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to restore knowledge base', restoreError, {
      sourceBaseId: 'source-base',
      name: 'Legacy KB_bak',
      embeddingModelId: 'openai::text-embedding-3-small'
    })
  })
})

describe('useEnableKnowledgeBaseEmbedding', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue(createKnowledgeBase())
  })

  it('enables the embedding model through runtime IPC and refreshes the list', async () => {
    const updatedBase = createKnowledgeBase({
      id: 'base-1',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    })
    mockIpcRequest.mockResolvedValueOnce(updatedBase)

    const { result } = renderHook(() => useEnableKnowledgeBaseEmbedding())
    let updated: KnowledgeBase | undefined

    await act(async () => {
      updated = await result.current.enableEmbedding('  base-1  ', {
        embeddingModelId: '  openai::text-embedding-3-small  ',
        dimensions: 1536,
        chunkSize: 512
      })
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.enable_embedding_model', {
      baseId: 'base-1',
      patch: {
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1536,
        chunkSize: 512
      }
    })
    // Also refreshes the item list — enabling embedding flips every existing item back to
    // processing/embedding, and the item list's own polling had already stopped.
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(updated).toEqual(updatedBase)
    expect(result.current.isEnabling).toBe(false)
    expect(result.current.enableError).toBeUndefined()
  })

  it('rejects before calling IPC when the embedding model is missing', async () => {
    const { result } = renderHook(() => useEnableKnowledgeBaseEmbedding())

    await act(async () => {
      await expect(
        result.current.enableEmbedding('base-1', { embeddingModelId: null, dimensions: 1536 })
      ).rejects.toThrow('Knowledge base embedding model is required')
    })

    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('rejects before calling IPC when dimensions are not a positive integer', async () => {
    const { result } = renderHook(() => useEnableKnowledgeBaseEmbedding())

    await act(async () => {
      await expect(
        result.current.enableEmbedding('base-1', {
          embeddingModelId: 'openai::text-embedding-3-small',
          dimensions: 0
        })
      ).rejects.toThrow('Knowledge base dimensions must be a positive integer')
    })

    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('keeps enable rejected when runtime IPC fails without refreshing the list', async () => {
    const enableError = new Error('enable failed')
    mockIpcRequest.mockRejectedValueOnce(enableError)
    const { result } = renderHook(() => useEnableKnowledgeBaseEmbedding())

    await act(async () => {
      await expect(
        result.current.enableEmbedding('base-1', {
          embeddingModelId: 'openai::text-embedding-3-small',
          dimensions: 1536
        })
      ).rejects.toBe(enableError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.isEnabling).toBe(false)
    expect(result.current.enableError).toBe(enableError)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to enable knowledge base embedding', enableError, {
      baseId: 'base-1',
      embeddingModelId: 'openai::text-embedding-3-small'
    })
  })
})

describe('useUpdateKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates a knowledge base with the expected params and body', async () => {
    const updates: UpdateKnowledgeBaseDto = {
      groupId: 'group-2'
    }
    const updatedBase = createKnowledgeBase({
      id: 'base-1',
      name: 'Base 1',
      groupId: 'group-2'
    })
    const trigger = vi.fn().mockResolvedValue(updatedBase)
    const updateError = new Error('update failed')

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: false,
      error: updateError
    })

    const { result } = renderHook(() => useUpdateKnowledgeBase())
    let updated: KnowledgeBase | undefined

    await act(async () => {
      updated = await result.current.updateBase('base-1', updates)
    })

    expect(mockUseMutation).toHaveBeenCalledWith('PATCH', '/knowledge-bases/:id', {
      refresh: ['/knowledge-bases']
    })
    expect(trigger).toHaveBeenCalledWith({
      params: { id: 'base-1' },
      body: updates
    })
    expect(updated).toEqual(updatedBase)
    expect(result.current.isUpdating).toBe(false)
    expect(result.current.updateError).toBe(updateError)
  })
})

describe('useDeleteKnowledgeBase', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue(undefined)
  })

  it('deletes a knowledge base through runtime IPC and refreshes dependent caches', async () => {
    const { result } = renderHook(() => useDeleteKnowledgeBase())

    await act(async () => {
      await result.current.deleteBase('base-1')
    })

    expect(mockUseMutation).not.toHaveBeenCalled()
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.delete_base', { baseId: 'base-1' })
    expect(mockInvalidateCache).toHaveBeenCalledWith([
      '/knowledge-bases',
      '/agents',
      '/agents/*',
      '/assistants',
      '/assistants/*'
    ])
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.deleteError).toBeUndefined()
  })

  it('keeps delete rejected when runtime IPC fails and still refreshes the list', async () => {
    const deleteError = new Error('delete failed')
    mockIpcRequest.mockRejectedValueOnce(deleteError)
    const { result } = renderHook(() => useDeleteKnowledgeBase())

    await act(async () => {
      await expect(result.current.deleteBase('base-1')).rejects.toBe(deleteError)
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith([
      '/knowledge-bases',
      '/agents',
      '/agents/*',
      '/assistants',
      '/assistants/*'
    ])
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.deleteError).toBe(deleteError)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to delete knowledge base', deleteError, {
      baseId: 'base-1'
    })
  })
})
