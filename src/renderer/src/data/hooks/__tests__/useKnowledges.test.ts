import { useQuery } from '@data/hooks/useDataApi'
import type { KnowledgeItem, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeItems } from '../useKnowledges'

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: vi.fn()
}))

const mockUseQuery = vi.mocked(useQuery)

const createMockItem = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({
    id: 'item-1',
    baseId: 'base-1',
    parentId: null,
    type: 'file',
    data: { file: { name: 'test.txt', path: '/test.txt', size: 100, ext: '.txt' } },
    status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides
  }) as KnowledgeItem

const createTreeNode = (item: KnowledgeItem, children: KnowledgeItemTreeNode[] = []): KnowledgeItemTreeNode => ({
  item,
  children
})

beforeEach(() => {
  mockUseQuery.mockReset()
  mockUseQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
  })
})

describe('useKnowledgeItems', () => {
  it('disables query when baseId is empty', () => {
    const { result } = renderHook(() => useKnowledgeItems(''))

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases//items', expect.objectContaining({ enabled: false }))
    expect(result.current.items).toEqual([])
    expect(result.current.treeItems).toEqual([])
    expect(result.current.total).toBe(0)
  })

  it('returns tree and flattened items in depth-first order', () => {
    const treeItems: KnowledgeItemTreeNode[] = [
      createTreeNode(
        createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/docs', recursive: true } as any }),
        [
          createTreeNode(createMockItem({ id: 'file-1', parentId: 'dir-1' })),
          createTreeNode(
            createMockItem({
              id: 'dir-2',
              type: 'directory',
              parentId: 'dir-1',
              data: { path: '/docs/sub', recursive: true } as any
            }),
            [createTreeNode(createMockItem({ id: 'file-2', parentId: 'dir-2' }))]
          )
        ]
      )
    ]

    mockUseQuery.mockReturnValue({
      data: treeItems,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    expect(mockUseQuery).toHaveBeenCalledWith(
      '/knowledge-bases/base-1/items',
      expect.objectContaining({ enabled: true })
    )
    expect(result.current.treeItems).toEqual(treeItems)
    expect(result.current.items.map((item) => item.id)).toEqual(['dir-1', 'file-1', 'dir-2', 'file-2'])
    expect(result.current.total).toBe(4)
  })
})
