import { useKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseQuery = vi.fn()
const expectKnowledgeItemsQuery = (baseId: string, enabled: boolean) => {
  expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: { page: 1, limit: 100, groupId: null },
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

  it('queries the selected knowledge base root items and returns API results directly', () => {
    const items = [
      {
        id: 'directory-parent',
        baseId: 'base-1',
        groupId: null,
        type: 'directory',
        data: {
          source: '/tmp/example-directory',
          path: '/tmp/example-directory'
        },
        status: 'completed',
        phase: null,
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
          source: '/tmp/example-directory/nested',
          path: '/tmp/example-directory/nested'
        },
        status: 'completed',
        phase: null,
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
          source: '/tmp/report.pdf',
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
        phase: null,
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
          source: 'grouped-note',
          content: 'Grouped note'
        },
        status: 'completed',
        phase: null,
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
          source: 'standalone-note',
          content: 'Example note'
        },
        status: 'completed',
        phase: null,
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
    expect(result.current.items).toBe(items)
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

  it('polls while any returned item is non-terminal and stops when all terminal', () => {
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
            data: { source: '/docs', path: '/docs' },
            status: 'completed',
            phase: null,
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
              source: '/docs/grouped.md',
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
            status: 'processing',
            phase: 'embedding',
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          },
          {
            id: 'item-pending',
            baseId: 'base-1',
            groupId: null,
            type: 'note',
            data: { source: 'item-processing', content: 'processing' },
            status: 'processing',
            phase: null,
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
            data: { source: 'item-completed', content: 'completed' },
            status: 'completed',
            phase: null,
            error: null,
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          },
          {
            id: 'item-failed',
            baseId: 'base-1',
            groupId: null,
            type: 'note',
            data: { source: 'item-failed', content: 'failed' },
            status: 'failed',
            phase: null,
            error: 'failed',
            createdAt: '2026-04-21T10:00:00+08:00',
            updatedAt: '2026-04-21T10:00:00+08:00'
          }
        ]
      })
    ).toBe(0)
  })
})
