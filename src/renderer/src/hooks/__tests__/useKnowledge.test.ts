import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import type { KnowledgeItem, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useKnowledgeDirectories,
  useKnowledgeFiles,
  useKnowledgeItemDelete,
  useKnowledgeSearch
} from '../useKnowledges'

const mockDataApiService = vi.mocked(dataApiService)
const mockUseMutation = vi.mocked(useMutation)
const mockUseInvalidateCache = vi.mocked(useInvalidateCache)

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

const BASE_ID = 'base-1'

let mockItems: KnowledgeItem[] = []
let mockTreeItems: KnowledgeItemTreeNode[] = []

vi.mock('@renderer/data/hooks/useKnowledgeData', () => ({
  useKnowledgeItems: () => ({
    items: mockItems,
    treeItems: mockTreeItems,
    total: mockItems.length,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasProcessingItems: false,
    refetch: vi.fn(),
    mutate: vi.fn()
  })
}))

let mockInvalidateFn: ReturnType<typeof vi.fn>
let mockTriggerFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockItems = []
  mockTreeItems = []

  mockTriggerFn = vi.fn().mockResolvedValue({ items: [] })
  mockUseMutation.mockReturnValue({
    trigger: mockTriggerFn,
    isLoading: false,
    error: undefined
  })

  mockInvalidateFn = vi.fn().mockResolvedValue(undefined)
  mockUseInvalidateCache.mockReturnValue(mockInvalidateFn)

  mockDataApiService.post.mockReset()
  mockDataApiService.get.mockReset()
  mockDataApiService.delete.mockReset()
  mockDataApiService.post.mockResolvedValue({})
  mockDataApiService.get.mockResolvedValue([])
  mockDataApiService.delete.mockResolvedValue({ deleted: true })

  vi.stubGlobal('api', {
    file: {
      listDirectory: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ name: 'file.txt', path: '/dir/file.txt', size: 50, ext: '.txt' }),
      read: vi.fn().mockResolvedValue('[]'),
      writeWithId: vi.fn().mockResolvedValue(undefined)
    }
  })

  vi.stubGlobal('toast', {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useKnowledgeFiles', () => {
  it('filters to root file items only', () => {
    mockItems = [
      createMockItem({ id: 'f1', type: 'file', parentId: null }),
      createMockItem({ id: 'f-child', type: 'file', parentId: 'dir-1' }),
      createMockItem({ id: 'u1', type: 'url' }),
      createMockItem({ id: 'f2', type: 'file', parentId: null })
    ]

    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    expect(result.current.fileItems).toHaveLength(2)
    expect(result.current.fileItems.every((item) => item.type === 'file' && !item.parentId)).toBe(true)
  })

  it('calls trigger with file payload', async () => {
    const files = [
      {
        id: '1',
        name: 'a.txt',
        origin_name: 'a.txt',
        path: '/a.txt',
        size: 10,
        ext: '.txt',
        type: 'text',
        created_at: '',
        count: 0
      }
    ] as any[]

    mockTriggerFn.mockResolvedValue({ items: [createMockItem({ id: 'new-1' })] })

    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    await act(async () => {
      await result.current.addFiles(files)
    })

    expect(mockTriggerFn).toHaveBeenCalledWith({
      body: {
        items: [
          {
            type: 'file',
            data: { file: files[0] }
          }
        ]
      }
    })
  })

  it('refreshes a file and invalidates list', async () => {
    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    await act(async () => {
      await result.current.refreshItem('file-1')
    })

    expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/file-1/reprocess', {})
    expect(mockInvalidateFn).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/items`)
  })
})

describe('useKnowledgeDirectories', () => {
  it('filters items to directory type only', () => {
    mockItems = [
      createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any }),
      createMockItem({ id: 'file-1', type: 'file' })
    ]

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    expect(result.current.directoryItems).toHaveLength(1)
    expect(result.current.directoryItems[0].type).toBe('directory')
  })

  it('shows toast when selected directory has no files', async () => {
    ;(window.api.file.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    await act(async () => {
      await result.current.addDirectory('/empty-dir')
    })

    expect(window.toast.info).toHaveBeenCalled()
    expect(mockTriggerFn).not.toHaveBeenCalled()
  })

  it('creates directory container then creates child files with parentId', async () => {
    ;(window.api.file.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(['/dir/a.txt', '/dir/b.txt'])
    ;(window.api.file.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => ({
      name: path.split('/').pop(),
      origin_name: path.split('/').pop(),
      path,
      size: 100,
      ext: '.txt',
      type: 'text',
      created_at: '',
      count: 0
    }))

    mockTriggerFn
      .mockResolvedValueOnce({
        items: [createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any })]
      })
      .mockResolvedValueOnce({
        items: [createMockItem({ id: 'f1', type: 'file' }), createMockItem({ id: 'f2', type: 'file' })]
      })

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    await act(async () => {
      await result.current.addDirectory('/dir')
    })

    expect(mockTriggerFn).toHaveBeenCalledTimes(2)

    const firstCallItems = mockTriggerFn.mock.calls[0][0].body.items
    expect(firstCallItems).toHaveLength(1)
    expect(firstCallItems[0].type).toBe('directory')
    expect(firstCallItems[0].data.path).toBe('/dir')

    const secondCallItems = mockTriggerFn.mock.calls[1][0].body.items
    expect(secondCallItems).toHaveLength(2)
    expect(secondCallItems[0].type).toBe('file')
    expect(secondCallItems[0].parentId).toBe('dir-1')
    expect(secondCallItems[1].type).toBe('file')
    expect(secondCallItems[1].parentId).toBe('dir-1')
  })

  it('deletes directory by directory id', async () => {
    mockItems = [createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any })]
    mockTreeItems = [
      createTreeNode(
        createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any }),
        [createTreeNode(createMockItem({ id: 'f1', type: 'file', parentId: 'dir-1' }))]
      )
    ]

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    await act(async () => {
      await result.current.deleteGroup('dir-1')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledTimes(1)
    expect(mockDataApiService.delete).toHaveBeenCalledWith('/knowledge-items/dir-1')
  })

  it('refreshes only completed file children in a directory', async () => {
    mockItems = [createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any })]
    mockTreeItems = [
      createTreeNode(
        createMockItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any }),
        [
          createTreeNode(createMockItem({ id: 'f1', type: 'file', parentId: 'dir-1', status: 'completed' })),
          createTreeNode(createMockItem({ id: 'f2', type: 'file', parentId: 'dir-1', status: 'failed' })),
          createTreeNode(createMockItem({ id: 'f3', type: 'file', parentId: 'dir-1', status: 'completed' }))
        ]
      )
    ]

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    await act(async () => {
      await result.current.refreshGroup('dir-1')
    })

    expect(mockDataApiService.post).toHaveBeenCalledTimes(2)
    expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/f1/reprocess', {})
    expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/f3/reprocess', {})
    expect(mockInvalidateFn).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/items`)
  })
})

describe('useKnowledgeItemDelete', () => {
  it('calls delete and invalidates cache', async () => {
    const { result } = renderHook(() => useKnowledgeItemDelete())

    await act(async () => {
      await result.current.deleteItem('base-1', 'item-1')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/knowledge-items/item-1')
    expect(mockInvalidateFn).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
  })
})

describe('useKnowledgeSearch', () => {
  it('returns empty array for empty query', async () => {
    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    let searchResult: unknown
    await act(async () => {
      searchResult = await result.current.search({ search: '' })
    })

    expect(searchResult).toEqual([])
    expect(mockDataApiService.get).not.toHaveBeenCalled()
  })

  it('calls search api with query', async () => {
    const mockResults = [{ id: 'r1', content: 'result', score: 0.9 }]
    mockDataApiService.get.mockResolvedValue(mockResults)

    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    await act(async () => {
      await result.current.search({ search: 'test query' })
    })

    expect(mockDataApiService.get).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/search`, {
      query: { search: 'test query' }
    })
  })
})
