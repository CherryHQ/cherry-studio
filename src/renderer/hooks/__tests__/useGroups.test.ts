import type { Group } from '@shared/data/types/group'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGroupMutations, useGroups } from '../useGroups'

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
  refetch: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

function group(id: string, name: string): Group {
  return {
    id,
    entityType: 'assistant',
    name,
    orderKey: 'a0',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  }
}

describe('group hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: undefined,
      refetch: mocks.refetch
    })
    mocks.useMutation.mockImplementation((method: string, path: string) => ({
      trigger:
        method === 'POST' && path === '/groups'
          ? mocks.createGroup
          : method === 'PATCH'
            ? mocks.updateGroup
            : mocks.deleteGroup,
      isLoading: false,
      error: undefined
    }))
  })

  it('lists groups for the requested entity type', () => {
    const cached = group('11111111-1111-4111-8111-111111111111', 'work')
    mocks.useQuery.mockReturnValue({
      data: [cached],
      isLoading: false,
      error: undefined,
      refetch: mocks.refetch
    })

    const { result } = renderHook(() => useGroups('assistant'))

    expect(mocks.useQuery).toHaveBeenCalledWith('/groups', { query: { entityType: 'assistant' } })
    expect(result.current.groups).toEqual([cached])
  })

  it('uses the supplied entity type and refresh targets for mutations', async () => {
    const created = group('11111111-1111-4111-8111-111111111111', 'work')
    mocks.createGroup.mockResolvedValue(created)
    mocks.updateGroup.mockResolvedValue({ ...created, name: 'renamed' })
    mocks.deleteGroup.mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useGroupMutations('assistant', {
        refreshOnDelete: ['/assistants', '/assistants/*']
      })
    )

    await act(async () => {
      await result.current.createGroup(' work ')
      await result.current.updateGroup(created.id, { name: ' renamed ' })
      await result.current.deleteGroup(created.id)
    })

    expect(mocks.createGroup).toHaveBeenCalledWith({ body: { entityType: 'assistant', name: 'work' } })
    expect(mocks.updateGroup).toHaveBeenCalledWith({ params: { id: created.id }, body: { name: 'renamed' } })
    expect(mocks.deleteGroup).toHaveBeenCalledWith({ params: { id: created.id } })
    expect(mocks.useMutation).toHaveBeenCalledWith('DELETE', '/groups/:id', {
      refresh: ['/groups', '/assistants', '/assistants/*']
    })
  })
})
