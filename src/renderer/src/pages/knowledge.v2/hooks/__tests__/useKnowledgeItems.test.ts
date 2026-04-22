import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeItems } from '../useKnowledgeItems'

const mockUseQuery = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

describe('useKnowledgeItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries the selected knowledge base items and returns only top-level items', () => {
    const items = [
      {
        id: 'directory-parent',
        baseId: 'base-1',
        groupId: null,
        type: 'directory',
        data: {
          name: 'Example Directory',
          path: '/tmp/example-directory'
        },
        status: 'completed',
        error: null,
        createdAt: '2026-04-21T10:00:00+08:00',
        updatedAt: '2026-04-21T10:00:00+08:00'
      },
      {
        id: 'directory-child',
        baseId: 'base-1',
        groupId: 'directory-parent',
        type: 'directory',
        data: {
          name: 'Nested Directory',
          path: '/tmp/example-directory/nested'
        },
        status: 'completed',
        error: null,
        createdAt: '2026-04-21T10:00:00+08:00',
        updatedAt: '2026-04-21T10:00:00+08:00'
      },
      {
        id: 'directory-file',
        baseId: 'base-1',
        groupId: 'directory-parent',
        type: 'file',
        data: {
          file: {
            id: 'file-1',
            name: 'report.pdf',
            origin_name: 'report.pdf',
            path: '/tmp/report.pdf',
            size: 1024,
            ext: 'pdf',
            type: 'document',
            created_at: '2026-04-21T10:00:00+08:00',
            count: 1
          }
        },
        status: 'completed',
        error: null,
        createdAt: '2026-04-21T10:00:00+08:00',
        updatedAt: '2026-04-21T10:00:00+08:00'
      },
      {
        id: 'grouped-note',
        baseId: 'base-1',
        groupId: 'directory-child',
        type: 'note',
        data: {
          content: 'Grouped note'
        },
        status: 'completed',
        error: null,
        createdAt: '2026-04-21T10:00:00+08:00',
        updatedAt: '2026-04-21T10:00:00+08:00'
      },
      {
        id: 'standalone-note',
        baseId: 'base-1',
        groupId: null,
        type: 'note',
        data: {
          content: 'Example note'
        },
        status: 'completed',
        error: null,
        createdAt: '2026-04-21T10:00:00+08:00',
        updatedAt: '2026-04-21T10:00:00+08:00'
      }
    ] satisfies KnowledgeItem[]

    const refetch = vi.fn()

    mockUseQuery.mockReturnValue({
      data: {
        items,
        total: items.length,
        page: 1
      },
      isLoading: false,
      error: undefined,
      refetch
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id/items', {
      params: { id: 'base-1' },
      query: { page: 1, limit: 100 },
      enabled: true
    })
    expect(result.current.items.map((item) => item.id)).toEqual(['directory-parent', 'standalone-note'])
    expect(result.current.total).toBe(items.length)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.refetch).toBe(refetch)
  })

  it('does not enable the query before a knowledge base is selected', () => {
    const error = new Error('disabled')
    const refetch = vi.fn()

    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
      refetch
    })

    const { result } = renderHook(() => useKnowledgeItems(''))

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id/items', {
      params: { id: '' },
      query: { page: 1, limit: 100 },
      enabled: false
    })
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.error).toBe(error)
    expect(result.current.refetch).toBe(refetch)
  })
})
