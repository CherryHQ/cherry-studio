import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { Tag } from '@shared/data/types/tag'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEntityTags, useSyncEntityTags } from '../useEntityTags'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  syncTrigger: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation
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

describe('useEntityTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: mocks.refetch
    })
    mocks.useMutation.mockReturnValue({
      trigger: mocks.syncTrigger,
      isLoading: false,
      error: undefined
    })
  })

  it('returns an empty disabled state when entityId is missing', () => {
    const { result } = renderHook(() => useEntityTags('assistant', undefined))

    expect(mocks.useQuery).toHaveBeenCalledWith('/tags/entities/assistant/placeholder', { enabled: false })
    expect(result.current).toMatchObject({
      tags: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined
    })
  })

  it('respects enabled=false without exposing loading state', () => {
    mocks.useQuery.mockReturnValueOnce({
      data: [tag('tag-1', 'work')],
      isLoading: true,
      isRefreshing: true,
      error: new Error('disabled query error'),
      refetch: mocks.refetch
    })

    const { result } = renderHook(() => useEntityTags('assistant', 'ast-1', { enabled: false }))

    expect(mocks.useQuery).toHaveBeenCalledWith('/tags/entities/assistant/ast-1', { enabled: false })
    expect(result.current).toMatchObject({
      tags: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined
    })
  })

  it('reads tags for a concrete entity path', () => {
    const work = tag('tag-1', 'work')
    mocks.useQuery.mockReturnValueOnce({
      data: [work],
      isLoading: false,
      isRefreshing: true,
      error: undefined,
      refetch: mocks.refetch
    })

    const { result } = renderHook(() => useEntityTags('topic', '018f0c58-0a5b-7cc8-bff1-e28c5e73dd13'))

    expect(mocks.useQuery).toHaveBeenCalledWith('/tags/entities/topic/018f0c58-0a5b-7cc8-bff1-e28c5e73dd13', {
      enabled: true
    })
    expect(result.current.tags).toEqual([work])
    expect(result.current.isRefreshing).toBe(true)
  })

  it('syncs entity tag ids through the template endpoint', async () => {
    mocks.syncTrigger.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useSyncEntityTags())

    await act(async () => {
      await result.current.syncEntityTags('assistant', '018f0c58-0a5b-7cc8-bff1-e28c5e73dd13', ['tag-1', 'tag-2'])
    })

    expect(mocks.syncTrigger).toHaveBeenCalledWith({
      params: { entityType: 'assistant', entityId: '018f0c58-0a5b-7cc8-bff1-e28c5e73dd13' },
      body: { tagIds: ['tag-1', 'tag-2'] }
    })
  })

  it('refreshes tags and the current entity path by default', () => {
    renderHook(() => useSyncEntityTags())

    const options = mocks.useMutation.mock.calls[0][2]
    const refresh = options.refresh({
      args: {
        params: { entityType: 'assistant', entityId: '018f0c58-0a5b-7cc8-bff1-e28c5e73dd13' },
        body: { tagIds: ['tag-1'] }
      },
      result: undefined
    })

    expect(refresh).toEqual(['/tags', '/tags/entities/assistant/018f0c58-0a5b-7cc8-bff1-e28c5e73dd13'])
  })

  it('adds caller-provided refresh paths', () => {
    renderHook(() =>
      useSyncEntityTags({
        getRefreshPaths: ({ entityType }) => (entityType === 'assistant' ? ['/assistants'] : [])
      })
    )

    const options = mocks.useMutation.mock.calls[0][2]
    const refresh = options.refresh({
      args: {
        params: { entityType: 'assistant', entityId: '018f0c58-0a5b-7cc8-bff1-e28c5e73dd13' },
        body: { tagIds: ['tag-1'] }
      },
      result: undefined
    }) satisfies ConcreteApiPaths[]

    expect(refresh).toEqual(['/tags', '/tags/entities/assistant/018f0c58-0a5b-7cc8-bff1-e28c5e73dd13', '/assistants'])
  })
})
