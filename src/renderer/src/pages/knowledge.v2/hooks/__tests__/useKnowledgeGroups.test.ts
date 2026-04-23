import type { Group } from '@shared/data/types/group'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCreateKnowledgeGroup, useKnowledgeGroups } from '../useKnowledgeGroups'

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
