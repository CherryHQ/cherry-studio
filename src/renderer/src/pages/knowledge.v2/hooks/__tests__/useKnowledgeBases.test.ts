import type { CreateKnowledgeBaseInput } from '@renderer/pages/knowledge.v2/types'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeBases,
  useUpdateKnowledgeBase
} from '../useKnowledgeBases'

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
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
  searchMode: undefined,
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a knowledge base with the selected group id in the request body and declares refresh via useMutation', async () => {
    const createdBase = createKnowledgeBase({
      id: 'base-2',
      name: 'Base 2',
      groupId: 'group-2',
      emoji: '📚',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 2048
    })
    const trigger = vi.fn().mockResolvedValue(createdBase)
    const createError = new Error('create failed')
    const input: CreateKnowledgeBaseInput = {
      name: '  Base 2  ',
      emoji: '📚',
      groupId: 'group-2',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: '2048'
    }

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: true,
      error: createError
    })

    const { result } = renderHook(() => useCreateKnowledgeBase())
    let created: KnowledgeBase | undefined

    await act(async () => {
      created = await result.current.createBase(input)
    })

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/knowledge-bases', {
      refresh: ['/knowledge-bases']
    })
    expect(trigger).toHaveBeenCalledWith({
      body: {
        name: 'Base 2',
        emoji: '📚',
        groupId: 'group-2',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 2048
      }
    })
    expect(created).toEqual(createdBase)
    expect(result.current.isCreating).toBe(true)
    expect(result.current.createError).toBe(createError)
  })

  it('omits groupId from the request body when the input stays ungrouped', async () => {
    const createdBase = createKnowledgeBase({
      id: 'base-3',
      name: 'Base 3',
      emoji: '🧠',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: 1536
    })
    const trigger = vi.fn().mockResolvedValue(createdBase)
    const input: CreateKnowledgeBaseInput = {
      name: 'Base 3',
      emoji: '🧠',
      embeddingModelId: 'openai::text-embedding-3-small',
      dimensions: '1536'
    }

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: false,
      error: undefined
    })

    const { result } = renderHook(() => useCreateKnowledgeBase())

    await act(async () => {
      await result.current.createBase(input)
    })

    expect(trigger).toHaveBeenCalledWith({
      body: {
        name: 'Base 3',
        emoji: '🧠',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1536
      }
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a knowledge base with the expected params', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    const deleteError = new Error('delete failed')

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: true,
      error: deleteError
    })

    const { result } = renderHook(() => useDeleteKnowledgeBase())

    await act(async () => {
      await result.current.deleteBase('base-1')
    })

    expect(mockUseMutation).toHaveBeenCalledWith('DELETE', '/knowledge-bases/:id', {
      refresh: ['/knowledge-bases']
    })
    expect(trigger).toHaveBeenCalledWith({
      params: { id: 'base-1' }
    })
    expect(result.current.isDeleting).toBe(true)
    expect(result.current.deleteError).toBe(deleteError)
  })
})
