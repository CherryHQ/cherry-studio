import { DataApiError, ErrorCode } from '@shared/data/api'
import type { Tag } from '@shared/data/types/tag'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDeleteTag, useEnsureTags, useRenameTag } from '../useTags'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  createTag: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  dataApiGet: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: mocks.dataApiGet
  }
}))

function tag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: '#3b82f6',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z'
  }
}

function conflictError() {
  return new DataApiError(ErrorCode.CONFLICT, 'Tag already exists', 409)
}

describe('useEnsureTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mocks.useMutation.mockReturnValue({
      trigger: mocks.createTag,
      isLoading: false,
      error: undefined
    })
  })

  it('uses cached tags without POSTing', async () => {
    const cached = tag('tag-1', 'work')
    mocks.useQuery.mockReturnValue({ data: [cached], isLoading: false, error: undefined, refetch: vi.fn() })

    const { result } = renderHook(() => useEnsureTags())
    let ensured: Tag[] = []
    await act(async () => {
      ensured = await result.current.ensureTags(['work'])
    })

    expect(ensured).toEqual([cached])
    expect(mocks.createTag).not.toHaveBeenCalled()
  })

  it('resolves a conflict through an imperative GET hit', async () => {
    const fresh = tag('tag-2', 'work')
    mocks.createTag.mockRejectedValueOnce(conflictError())
    mocks.dataApiGet.mockResolvedValueOnce([fresh])

    const { result } = renderHook(() => useEnsureTags())
    let ensured: Tag[] = []
    await act(async () => {
      ensured = await result.current.ensureTags(['work'])
    })

    expect(mocks.createTag).toHaveBeenCalledWith({ body: expect.objectContaining({ name: 'work' }) })
    expect(mocks.dataApiGet).toHaveBeenCalledWith('/tags')
    expect(ensured).toEqual([fresh])
  })

  it('rethrows the original conflict when imperative GET misses', async () => {
    const error = conflictError()
    mocks.createTag.mockRejectedValueOnce(error)
    mocks.dataApiGet.mockResolvedValueOnce([])

    const { result } = renderHook(() => useEnsureTags())

    await expect(result.current.ensureTags(['work'])).rejects.toBe(error)
  })

  it('rethrows non-conflict errors directly', async () => {
    const error = new Error('network down')
    mocks.createTag.mockRejectedValueOnce(error)

    const { result } = renderHook(() => useEnsureTags())

    await expect(result.current.ensureTags(['work'])).rejects.toBe(error)
    expect(mocks.dataApiGet).not.toHaveBeenCalled()
  })

  it('skips empty names and de-duplicates before creating', async () => {
    const created = tag('tag-3', 'work')
    mocks.createTag.mockResolvedValueOnce(created)

    const { result } = renderHook(() => useEnsureTags())
    let ensured: Tag[] = []
    await act(async () => {
      ensured = await result.current.ensureTags([' ', 'work', { name: ' work ', color: '#fff' }])
    })

    expect(mocks.createTag).toHaveBeenCalledTimes(1)
    expect(mocks.createTag).toHaveBeenCalledWith({ body: expect.objectContaining({ name: 'work' }) })
    expect(ensured).toEqual([created])
  })
})

describe('useRenameTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMutation.mockReturnValue({
      trigger: mocks.renameTag,
      isLoading: false,
      error: undefined
    })
  })

  it('patches a trimmed tag name and refreshes tag consumers', async () => {
    const renamed = tag('tag-1', 'work')
    mocks.renameTag.mockResolvedValueOnce(renamed)

    const { result } = renderHook(() => useRenameTag())
    let updated: Tag | undefined
    await act(async () => {
      updated = await result.current.renameTag('tag-1', ' work ')
    })

    expect(mocks.useMutation).toHaveBeenCalledWith('PATCH', '/tags/:id', {
      refresh: ['/tags', '/assistants']
    })
    expect(mocks.renameTag).toHaveBeenCalledWith({
      params: { id: 'tag-1' },
      body: { name: 'work' }
    })
    expect(updated).toBe(renamed)
  })
})

describe('useDeleteTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMutation.mockReturnValue({
      trigger: mocks.deleteTag,
      isLoading: false,
      error: undefined
    })
  })

  it('deletes a tag and resolves without leaking mutation payloads', async () => {
    mocks.deleteTag.mockResolvedValueOnce({ ok: true })

    const { result } = renderHook(() => useDeleteTag())
    let deleted: unknown = 'pending'
    await act(async () => {
      deleted = await result.current.deleteTag('tag-1')
    })

    expect(mocks.useMutation).toHaveBeenCalledWith('DELETE', '/tags/:id', {
      refresh: ['/tags', '/assistants']
    })
    expect(mocks.deleteTag).toHaveBeenCalledWith({
      params: { id: 'tag-1' }
    })
    expect(deleted).toBeUndefined()
  })
})
