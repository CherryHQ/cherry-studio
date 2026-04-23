import type { Group } from '@shared/data/types/group'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCreateKnowledgeGroup,
  useDeleteKnowledgeGroup,
  useKnowledgeGroups,
  useUpdateKnowledgeGroup
} from '../useKnowledgeGroups'

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args)
}))

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Knowledge Group',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

describe('useKnowledgeGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries knowledge groups with entityType=knowledge', () => {
    const groups = [createGroup(), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })]
    const refetch = vi.fn()

    mockUseQuery.mockReturnValue({
      data: groups,
      isLoading: false,
      error: undefined,
      refetch
    })

    const { result } = renderHook(() => useKnowledgeGroups())

    expect(mockUseQuery).toHaveBeenCalledWith('/groups', {
      query: { entityType: 'knowledge' }
    })
    expect(result.current.groups).toEqual(groups)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.refetch).toBe(refetch)
  })

  it('returns an empty list before the groups query resolves', () => {
    const error = new Error('pending')

    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error,
      refetch: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeGroups())

    expect(result.current.groups).toEqual([])
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBe(error)
  })
})

describe('useCreateKnowledgeGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a knowledge group with the expected payload and refreshes groups', async () => {
    const createdGroup = createGroup({ name: 'Archive' })
    const trigger = vi.fn().mockResolvedValue(createdGroup)
    const createError = new Error('create failed')

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: true,
      error: createError
    })

    const { result } = renderHook(() => useCreateKnowledgeGroup())
    let created: Group | undefined

    await act(async () => {
      created = await result.current.createGroup('  Archive  ')
    })

    expect(mockUseMutation).toHaveBeenCalledWith('POST', '/groups', {
      refresh: ['/groups']
    })
    expect(trigger).toHaveBeenCalledWith({
      body: {
        entityType: 'knowledge',
        name: 'Archive'
      }
    })
    expect(created).toEqual(createdGroup)
    expect(result.current.isCreating).toBe(true)
    expect(result.current.createError).toBe(createError)
  })
})

describe('useUpdateKnowledgeGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PATCH /groups/:id and refreshes groups', async () => {
    const updatedGroup = createGroup({ id: 'group-1', name: 'Renamed Group' })
    const trigger = vi.fn().mockResolvedValue(updatedGroup)
    const updateError = new Error('update failed')

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: true,
      error: updateError
    })

    const { result } = renderHook(() => useUpdateKnowledgeGroup())
    let updated: Group | undefined

    await act(async () => {
      updated = await result.current.updateGroup('group-1', { name: 'Renamed Group' })
    })

    expect(mockUseMutation).toHaveBeenCalledWith('PATCH', '/groups/:id', {
      refresh: ['/groups']
    })
    expect(trigger).toHaveBeenCalledWith({
      params: { id: 'group-1' },
      body: { name: 'Renamed Group' }
    })
    expect(updated).toEqual(updatedGroup)
    expect(result.current.isUpdating).toBe(true)
    expect(result.current.updateError).toBe(updateError)
  })
})

describe('useDeleteKnowledgeGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends DELETE /groups/:id and refreshes groups', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    const deleteError = new Error('delete failed')

    mockUseMutation.mockReturnValue({
      trigger,
      isLoading: true,
      error: deleteError
    })

    const { result } = renderHook(() => useDeleteKnowledgeGroup())

    await act(async () => {
      await result.current.deleteGroup('group-1')
    })

    expect(mockUseMutation).toHaveBeenCalledWith('DELETE', '/groups/:id', {
      refresh: ['/groups', '/knowledge-bases']
    })
    expect(trigger).toHaveBeenCalledWith({
      params: { id: 'group-1' }
    })
    expect(result.current.isDeleting).toBe(true)
    expect(result.current.deleteError).toBe(deleteError)
  })
})
