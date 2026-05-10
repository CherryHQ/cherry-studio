import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { CreateKnowledgeBaseDto, KnowledgeBase } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../tests/__mocks__/RendererLoggerService'
import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeBases,
  useRestoreKnowledgeBase,
  useUpdateKnowledgeBase
} from '../useKnowledgeBases'

type CreateKnowledgeBaseInput = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId' | 'embeddingModelId' | 'dimensions'> & {
  emoji: string
}

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockRuntimeCreateBase = vi.fn()
const mockRuntimeRestoreBase = vi.fn()
const mockRuntimeDeleteBase = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useInvalidateCache: () => mockUseInvalidateCache()
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
  hybridAlpha: undefined,
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
    mockRuntimeCreateBase.mockResolvedValue(createKnowledgeBase())
    ;(window as any).api = {
      knowledgeRuntime: {
        createBase: mockRuntimeCreateBase
      }
    }
  })

  it('creates a knowledge base with the selected group id through runtime IPC and refreshes the list', async () => {
    const createdBase = createKnowledgeBase({
      id: 'base-2',
      name: 'Base 2',
      groupId: 'group-2',
      emoji: '📚',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
    })
    mockRuntimeCreateBase.mockResolvedValueOnce(createdBase)
    const input: CreateKnowledgeBaseInput = {
      name: '  Base 2  ',
      emoji: '📚',
      groupId: 'group-2',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
    }

    const { result } = renderHook(() => useCreateKnowledgeBase())
    let created: KnowledgeBase | undefined

    await act(async () => {
      created = await result.current.createBase(input)
    })

    expect(mockUseMutation).not.toHaveBeenCalled()
    expect(mockRuntimeCreateBase).toHaveBeenCalledWith({
      name: 'Base 2',
      emoji: '📚',
      groupId: 'group-2',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
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
      emoji: '🧠',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    })
    mockRuntimeCreateBase.mockResolvedValueOnce(createdBase)
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 3',
      emoji: '🧠',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    }

    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await result.current.createBase(input)
    })

    expect(mockRuntimeCreateBase).toHaveBeenCalledWith({
      name: 'Base 3',
      emoji: '🧠',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    })
  })

  it('keeps create rejected when runtime IPC fails without refreshing the list', async () => {
    const createError = new Error('create failed')
    mockRuntimeCreateBase.mockRejectedValueOnce(createError)
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 4',
      emoji: '📁',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
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
      groupId: undefined,
      embeddingModelId: 'openai::text-embedding-3-small'
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
    mockRuntimeRestoreBase.mockResolvedValue(createKnowledgeBase())
    ;(window as any).api = {
      knowledgeRuntime: {
        restoreBase: mockRuntimeRestoreBase
      }
    }
  })

  it('restores a knowledge base through runtime IPC and refreshes the list', async () => {
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      name: 'Legacy KB_bak',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1024
    })
    mockRuntimeRestoreBase.mockResolvedValueOnce(restoredBase)

    const { result } = renderHook(() => useRestoreKnowledgeBase())
    let restored: KnowledgeBase | undefined

    await act(async () => {
      restored = await result.current.restoreBase({
        sourceBaseId: '  source-base  ',
        name: '  Legacy KB_bak  ',
        embeddingModelId: '  openai::text-embedding-3-small  ',
        dimensions: 1024
      })
    })

    expect(mockRuntimeRestoreBase).toHaveBeenCalledWith({
      sourceBaseId: 'source-base',
      name: 'Legacy KB_bak',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1024
    })
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases')
    expect(restored).toEqual(restoredBase)
    expect(result.current.isRestoring).toBe(false)
    expect(result.current.restoreError).toBeUndefined()
  })

  it('keeps restore rejected when runtime IPC fails without refreshing the list', async () => {
    const restoreError = new Error('restore failed')
    mockRuntimeRestoreBase.mockRejectedValueOnce(restoreError)
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
    mockRuntimeDeleteBase.mockResolvedValue(undefined)
    ;(window as any).api = {
      knowledgeRuntime: {
        deleteBase: mockRuntimeDeleteBase
      }
    }
  })

  it('deletes a knowledge base through runtime IPC and refreshes the knowledge base list', async () => {
    const { result } = renderHook(() => useDeleteKnowledgeBase())

    await act(async () => {
      await result.current.deleteBase('base-1')
    })

    expect(mockUseMutation).not.toHaveBeenCalled()
    expect(mockRuntimeDeleteBase).toHaveBeenCalledWith('base-1')
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases')
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.deleteError).toBeUndefined()
  })

  it('keeps delete rejected when runtime IPC fails without refreshing the list', async () => {
    const deleteError = new Error('delete failed')
    mockRuntimeDeleteBase.mockRejectedValueOnce(deleteError)
    const { result } = renderHook(() => useDeleteKnowledgeBase())

    await act(async () => {
      await expect(result.current.deleteBase('base-1')).rejects.toBe(deleteError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.isDeleting).toBe(false)
    expect(result.current.deleteError).toBe(deleteError)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to delete knowledge base', deleteError, {
      baseId: 'base-1'
    })
  })
})
