import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeBaseById, useKnowledgeBaseMutations, useKnowledgeBases } from '../useKnowledgeBaseDataApi'

// ─── Mock data ────────────────────────────────────────────────────────
const mockKb1: any = {
  id: 'kb-1',
  name: 'KB One',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small'
}
const mockKb2: any = {
  id: 'kb-2',
  name: 'KB Two',
  dimensions: 1536,
  embeddingModelId: 'openai::text-embedding-3-small'
}
const mockListResponse = { items: [mockKb1, mockKb2], total: 2, page: 1, limit: 100 }

describe('useKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the items array from the offset-paginated response', () => {
    mockUseQuery.mockImplementation(() => ({
      data: mockListResponse,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useKnowledgeBases())

    expect(result.current.knowledgeBases).toEqual([mockKb1, mockKb2])
    expect(result.current.total).toBe(2)
    expect(result.current.isLoading).toBe(false)
  })

  it('falls back to a stable empty array when data is undefined', () => {
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result, rerender } = renderHook(() => useKnowledgeBases())
    const firstRef = result.current.knowledgeBases

    expect(firstRef).toEqual([])
    expect(result.current.total).toBe(0)

    rerender()
    expect(result.current.knowledgeBases).toBe(firstRef)
  })

  it('calls /knowledge-bases with the schema-capped limit', () => {
    renderHook(() => useKnowledgeBases())
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases', { query: { limit: 100 } })
  })
})

describe('useKnowledgeBaseById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the knowledgeBase entity from useQuery', () => {
    mockUseQuery.mockImplementation(() => ({
      data: mockKb1,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }))

    const { result } = renderHook(() => useKnowledgeBaseById('kb-1'))
    expect(result.current.knowledgeBase).toBe(mockKb1)
  })

  it('disables the query when id is undefined', () => {
    renderHook(() => useKnowledgeBaseById(undefined))
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id', { params: { id: '' }, enabled: false })
  })

  it('passes the id through and enables the query when id is provided', () => {
    renderHook(() => useKnowledgeBaseById('kb-42'))
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id', { params: { id: 'kb-42' }, enabled: true })
  })
})

describe('useKnowledgeBaseMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures POST/PATCH/DELETE mutations with the right refresh keys', () => {
    renderHook(() => useKnowledgeBaseMutations())

    const calls = mockUseMutation.mock.calls
    expect(calls.find((c: any[]) => c[0] === 'POST' && c[1] === '/knowledge-bases')).toBeDefined()
    expect(calls.find((c: any[]) => c[0] === 'PATCH' && c[1] === '/knowledge-bases/:id')).toBeDefined()
    expect(calls.find((c: any[]) => c[0] === 'DELETE' && c[1] === '/knowledge-bases/:id')).toBeDefined()

    for (const call of calls as any[][]) {
      expect(call[2]).toMatchObject({ refresh: ['/knowledge-bases', '/knowledge-bases/*'] })
    }
  })

  it('forwards the dto to the create trigger and returns the created entity', async () => {
    const created = { ...mockKb1, id: 'new-kb' }
    const createTrigger = vi.fn().mockResolvedValue(created)
    mockUseMutation.mockImplementation((method: string) => ({
      trigger: method === 'POST' ? createTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useKnowledgeBaseMutations())
    const dto = { name: 'New KB', dimensions: 1536, embeddingModelId: 'openai::text-embedding-3-small' }

    let returned: any
    await act(async () => {
      returned = await result.current.createKnowledgeBase(dto)
    })

    expect(createTrigger).toHaveBeenCalledWith({ body: dto })
    expect(returned).toBe(created)
  })

  it('passes id and patch to the update trigger', async () => {
    const updated = { ...mockKb1, name: 'Renamed' }
    const updateTrigger = vi.fn().mockResolvedValue(updated)
    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger: method === 'PATCH' && path === '/knowledge-bases/:id' ? updateTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useKnowledgeBaseMutations())

    let returned: any
    await act(async () => {
      returned = await result.current.updateKnowledgeBase('kb-1', { name: 'Renamed' })
    })

    expect(updateTrigger).toHaveBeenCalledWith({ params: { id: 'kb-1' }, body: { name: 'Renamed' } })
    expect(returned).toBe(updated)
  })

  it('passes id to the delete trigger', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger: method === 'DELETE' && path === '/knowledge-bases/:id' ? deleteTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))

    const { result } = renderHook(() => useKnowledgeBaseMutations())

    await act(async () => {
      await result.current.deleteKnowledgeBase('kb-1')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'kb-1' } })
  })

  it('exposes per-mutation loading flags', () => {
    mockUseMutation.mockImplementation((method: string) => ({
      trigger: vi.fn(),
      isLoading: method === 'POST',
      error: undefined
    }))

    const { result } = renderHook(() => useKnowledgeBaseMutations())
    expect(result.current.isCreating).toBe(true)
    expect(result.current.isUpdating).toBe(false)
    expect(result.current.isDeleting).toBe(false)
  })
})
