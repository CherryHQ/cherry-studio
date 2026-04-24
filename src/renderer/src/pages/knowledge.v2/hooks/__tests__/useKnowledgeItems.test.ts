import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeItems } from '../useKnowledgeItems'

const mockUseQuery = vi.fn()
const expectKnowledgeItemsQuery = (baseId: string, enabled: boolean) => {
  expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: { page: 1, limit: 100 },
    enabled,
    swrOptions: {
      refreshInterval: expect.any(Function)
    }
  })
}

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

    expectKnowledgeItemsQuery('base-1', true)
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

    expectKnowledgeItemsQuery('', false)
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.error).toBe(error)
    expect(result.current.refetch).toBe(refetch)
  })

  it('polls while any item, including grouped child items, is non-terminal and stops when all terminal', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    renderHook(() => useKnowledgeItems('base-1'))

    const refreshInterval = mockUseQuery.mock.calls[0][1].swrOptions.refreshInterval as (data?: {
      items: KnowledgeItem[]
    }) => number

    expect(refreshInterval(undefined)).toBe(0)
    expect(
      refreshInterval({
        items: [
          {
            id: 'directory-parent',
            baseId: 'base-1',
            groupId: null,
            type: 'directory',
            data: { name: 'docs', path: '/docs' },
            status: 'completed',
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          },
          {
            id: 'grouped-file',
            baseId: 'base-1',
            groupId: 'directory-parent',
            type: 'file',
            data: {
              file: {
                id: 'grouped-file-meta',
                name: 'grouped.md',
                origin_name: 'grouped.md',
                path: '/docs/grouped.md',
                size: 10,
                ext: '.md',
                type: 'text',
                created_at: '2026-04-21T10:00:00+08:00',
                count: 1
              }
            },
            status: 'embed',
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          },
          {
            id: 'item-pending',
            baseId: 'base-1',
            groupId: null,
            type: 'note',
            data: { content: 'pending' },
            status: 'pending',
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          }
        ]
      })
    ).toBe(2000)
    expect(
      refreshInterval({
        items: [
          {
            id: 'item-completed',
            baseId: 'base-1',
            groupId: null,
            type: 'note',
            data: { content: 'completed' },
            status: 'completed',
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          },
          {
            id: 'item-failed',
            baseId: 'base-1',
            groupId: null,
            type: 'note',
            data: { content: 'failed' },
            status: 'failed',
            error: 'failed',
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          }
        ]
      })
    ).toBe(0)
  })
})
