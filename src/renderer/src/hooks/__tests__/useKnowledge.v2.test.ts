import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useKnowledgeDirectories,
  useKnowledgeFiles,
  useKnowledgeItemDelete,
  useKnowledgeSearch
} from '../useKnowledge.v2'

// Access the mocked versions
const mockDataApiService = vi.mocked(dataApiService)
const mockUseMutation = vi.mocked(useMutation)
const mockUseInvalidateCache = vi.mocked(useInvalidateCache)

// ─── Helpers ───

const createMockItem = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({
    id: 'item-1',
    baseId: 'base-1',
    type: 'file',
    data: { file: { name: 'test.txt', path: '/test.txt', size: 100, ext: '.txt' } },
    status: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides
  }) as any

const BASE_ID = 'base-1'

// ─── Setup ───

// Mock useKnowledgeItems (from useKnowledges) — this is what each hook calls internally
let mockItems: KnowledgeItem[] = []

vi.mock('@renderer/data/hooks/useKnowledges', () => ({
  useKnowledgeItems: () => ({
    items: mockItems,
    total: mockItems.length,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasProcessingItems: false,
    refetch: vi.fn(),
    mutate: vi.fn()
  })
}))

// Mock uuid
vi.mock('@renderer/utils', () => ({
  uuid: () => 'mock-uuid'
}))

// Track mock invalidate function
let mockInvalidateFn: ReturnType<typeof vi.fn>
let mockTriggerFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockItems = []

  // Set up mockUseMutation to return a controllable trigger
  mockTriggerFn = vi.fn().mockResolvedValue({ items: [] })
  mockUseMutation.mockReturnValue({
    trigger: mockTriggerFn,
    isLoading: false,
    error: undefined
  })

  // Set up mockUseInvalidateCache to return a controllable invalidate fn
  mockInvalidateFn = vi.fn().mockResolvedValue(undefined)
  mockUseInvalidateCache.mockReturnValue(mockInvalidateFn)

  // Reset dataApiService mocks
  mockDataApiService.post.mockReset()
  mockDataApiService.get.mockReset()
  mockDataApiService.delete.mockReset()
  mockDataApiService.post.mockResolvedValue({})
  mockDataApiService.get.mockResolvedValue([])
  mockDataApiService.delete.mockResolvedValue({ deleted: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── useKnowledgeFiles ───

describe('useKnowledgeFiles', () => {
  it('filters items to file type only', () => {
    mockItems = [
      createMockItem({ id: 'f1', type: 'file' }),
      createMockItem({ id: 'u1', type: 'url' }),
      createMockItem({ id: 'f2', type: 'file' })
    ]

    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    expect(result.current.fileItems).toHaveLength(2)
    expect(result.current.fileItems.every((item) => item.type === 'file')).toBe(true)
  })

  it('computes hasProcessingItems from file items', () => {
    mockItems = [
      createMockItem({ id: 'f1', type: 'file', status: 'completed' }),
      createMockItem({ id: 'f2', type: 'file', status: 'pending' })
    ]

    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    expect(result.current.hasProcessingItems).toBe(true)
  })

  it('sets hasProcessingItems false when all files completed', () => {
    mockItems = [
      createMockItem({ id: 'f1', type: 'file', status: 'completed' }),
      createMockItem({ id: 'f2', type: 'file', status: 'failed' })
    ]

    const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

    expect(result.current.hasProcessingItems).toBe(false)
  })

  describe('addFiles', () => {
    it('returns undefined for empty files array', async () => {
      const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

      let returnValue: unknown
      await act(async () => {
        returnValue = await result.current.addFiles([])
      })

      expect(returnValue).toBeUndefined()
      expect(mockTriggerFn).not.toHaveBeenCalled()
    })

    it('calls trigger with correct v2 format', async () => {
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
        },
        {
          id: '2',
          name: 'b.pdf',
          origin_name: 'b.pdf',
          path: '/b.pdf',
          size: 20,
          ext: '.pdf',
          type: 'document',
          created_at: '',
          count: 0
        }
      ] as any[]
      const createdItems = files.map((f, i) => createMockItem({ id: `new-${i}`, data: { file: f } }))
      mockTriggerFn.mockResolvedValue({ items: createdItems })

      const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

      let returnValue: unknown
      await act(async () => {
        returnValue = await result.current.addFiles(files)
      })

      expect(mockTriggerFn).toHaveBeenCalledWith({
        body: {
          items: files.map((file) => ({
            type: 'file',
            data: { file }
          }))
        }
      })
      expect(returnValue).toEqual(createdItems)
    })
  })

  describe('deleteItem', () => {
    it('returns early when itemId is empty', async () => {
      const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

      await act(async () => {
        await result.current.deleteItem('')
      })

      expect(mockDataApiService.delete).not.toHaveBeenCalled()
    })
  })

  describe('refreshItem', () => {
    it('calls reprocess endpoint and invalidates cache', async () => {
      const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

      await act(async () => {
        await result.current.refreshItem('item-1')
      })

      expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/item-1/reprocess', {})
      expect(mockInvalidateFn).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/items`)
    })

    it('returns early when itemId is empty', async () => {
      const { result } = renderHook(() => useKnowledgeFiles(BASE_ID))

      await act(async () => {
        await result.current.refreshItem('')
      })

      expect(mockDataApiService.post).not.toHaveBeenCalled()
    })
  })
})

// ─── useKnowledgeDirectories ───

describe('useKnowledgeDirectories', () => {
  beforeEach(() => {
    // Mock window.api.file methods for directory tests
    vi.stubGlobal('api', {
      file: {
        listDirectory: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({ name: 'file.txt', path: '/dir/file.txt', size: 50, ext: '.txt' }),
        read: vi.fn().mockResolvedValue('[]'),
        writeWithId: vi.fn().mockResolvedValue(undefined)
      }
    })
    // Mock window.toast
    vi.stubGlobal('toast', {
      info: vi.fn(),
      error: vi.fn(),
      success: vi.fn()
    })
  })

  it('filters items to directory type only', () => {
    mockItems = [
      createMockItem({ id: 'd1', type: 'directory', data: { groupId: 'g1', groupName: '/dir', file: {} } as any }),
      createMockItem({ id: 'f1', type: 'file' })
    ]

    const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

    expect(result.current.directoryItems).toHaveLength(1)
    expect(result.current.directoryItems[0].type).toBe('directory')
  })

  describe('addDirectory', () => {
    it('returns undefined for empty path', async () => {
      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      let returnValue: unknown
      await act(async () => {
        returnValue = await result.current.addDirectory('')
      })

      expect(returnValue).toBeUndefined()
    })

    it('shows toast when directory has no files', async () => {
      ;(window.api.file.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([])

      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.addDirectory('/empty-dir')
      })

      expect(window.api.file.listDirectory).toHaveBeenCalledWith('/empty-dir', {
        recursive: true,
        includeFiles: true,
        includeDirectories: false,
        includeHidden: false,
        maxEntries: 100000,
        searchPattern: '.'
      })
      expect(window.toast.info).toHaveBeenCalled()
      expect(mockTriggerFn).not.toHaveBeenCalled()
    })

    it('builds directory items from file list and calls API', async () => {
      ;(window.api.file.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(['/dir/a.txt', '/dir/b.txt'])
      ;(window.api.file.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => ({
        name: path.split('/').pop(),
        path,
        size: 100,
        ext: '.txt'
      }))

      const createdItems = [createMockItem({ id: 'new-d1' })]
      mockTriggerFn.mockResolvedValue({ items: createdItems })

      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.addDirectory('/dir')
      })

      expect(mockTriggerFn).toHaveBeenCalledTimes(1)
      const callBody = mockTriggerFn.mock.calls[0][0].body
      expect(callBody.items).toHaveLength(2)
      expect(callBody.items[0].type).toBe('directory')
      expect(callBody.items[0].data.groupId).toBe('mock-uuid')
      expect(callBody.items[0].data.groupName).toBe('/dir')
    })

    it('filters out files that fail to read metadata', async () => {
      ;(window.api.file.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(['/dir/a.txt', '/dir/bad.txt'])
      ;(window.api.file.get as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.includes('bad')) throw new Error('read error')
        return { name: 'a.txt', path, size: 100, ext: '.txt' }
      })

      mockTriggerFn.mockResolvedValue({ items: [createMockItem()] })

      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.addDirectory('/dir')
      })

      const callBody = mockTriggerFn.mock.calls[0][0].body
      expect(callBody.items).toHaveLength(1)
    })
  })

  describe('deleteGroup', () => {
    it('deletes all items matching groupId', async () => {
      mockItems = [
        createMockItem({
          id: 'd1',
          type: 'directory',
          data: { groupId: 'g1', groupName: '/dir', file: {} } as any
        }),
        createMockItem({
          id: 'd2',
          type: 'directory',
          data: { groupId: 'g1', groupName: '/dir', file: {} } as any
        }),
        createMockItem({
          id: 'd3',
          type: 'directory',
          data: { groupId: 'g2', groupName: '/other', file: {} } as any
        })
      ]

      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.deleteGroup('g1')
      })

      // Should delete d1 and d2 (groupId=g1), not d3 (groupId=g2)
      expect(mockDataApiService.delete).toHaveBeenCalledTimes(2)
      expect(mockDataApiService.delete).toHaveBeenCalledWith('/knowledge-items/d1')
      expect(mockDataApiService.delete).toHaveBeenCalledWith('/knowledge-items/d2')
    })

    it('returns early when groupId is empty', async () => {
      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.deleteGroup('')
      })

      expect(mockDataApiService.delete).not.toHaveBeenCalled()
    })
  })

  describe('refreshGroup', () => {
    it('only reprocesses completed items in the group', async () => {
      mockItems = [
        createMockItem({
          id: 'd1',
          type: 'directory',
          status: 'completed',
          data: { groupId: 'g1', groupName: '/dir', file: {} } as any
        }),
        createMockItem({
          id: 'd2',
          type: 'directory',
          status: 'failed',
          data: { groupId: 'g1', groupName: '/dir', file: {} } as any
        }),
        createMockItem({
          id: 'd3',
          type: 'directory',
          status: 'completed',
          data: { groupId: 'g1', groupName: '/dir', file: {} } as any
        })
      ]

      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.refreshGroup('g1')
      })

      // Should reprocess d1 and d3 (completed), not d2 (failed)
      expect(mockDataApiService.post).toHaveBeenCalledTimes(2)
      expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/d1/reprocess', {})
      expect(mockDataApiService.post).toHaveBeenCalledWith('/knowledge-items/d3/reprocess', {})
      expect(mockInvalidateFn).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/items`)
    })

    it('returns early when groupId is empty', async () => {
      const { result } = renderHook(() => useKnowledgeDirectories(BASE_ID))

      await act(async () => {
        await result.current.refreshGroup('')
      })

      expect(mockDataApiService.post).not.toHaveBeenCalled()
    })
  })
})

// ─── useKnowledgeItemDelete ───

describe('useKnowledgeItemDelete', () => {
  it('calls dataApiService.delete and invalidates cache', async () => {
    const { result } = renderHook(() => useKnowledgeItemDelete())

    await act(async () => {
      await result.current.deleteItem('base-1', 'item-1')
    })

    expect(mockDataApiService.delete).toHaveBeenCalledWith('/knowledge-items/item-1')
    expect(mockInvalidateFn).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
  })

  it('manages isDeleting state correctly', async () => {
    // Make delete take time so we can observe loading state
    let resolveDelete!: () => void
    mockDataApiService.delete.mockImplementation(() => new Promise<void>((resolve) => (resolveDelete = resolve)))

    const { result } = renderHook(() => useKnowledgeItemDelete())

    expect(result.current.isDeleting).toBe(false)

    let deletePromise: Promise<void>
    act(() => {
      deletePromise = result.current.deleteItem('base-1', 'item-1')
    })

    expect(result.current.isDeleting).toBe(true)

    await act(async () => {
      resolveDelete()
      await deletePromise!
    })

    expect(result.current.isDeleting).toBe(false)
  })

  it('resets isDeleting on error and re-throws', async () => {
    const error = new Error('delete failed')
    mockDataApiService.delete.mockRejectedValue(error)

    const { result } = renderHook(() => useKnowledgeItemDelete())

    await expect(
      act(async () => {
        await result.current.deleteItem('base-1', 'item-1')
      })
    ).rejects.toThrow('delete failed')

    expect(result.current.isDeleting).toBe(false)
  })
})

// ─── useKnowledgeSearch ───

describe('useKnowledgeSearch', () => {
  it('returns empty array for empty search query', async () => {
    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    let searchResult: unknown
    await act(async () => {
      searchResult = await result.current.search({ search: '' })
    })

    expect(searchResult).toEqual([])
    expect(mockDataApiService.get).not.toHaveBeenCalled()
  })

  it('returns empty array for whitespace-only search query', async () => {
    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    let searchResult: unknown
    await act(async () => {
      searchResult = await result.current.search({ search: '   ' })
    })

    expect(searchResult).toEqual([])
  })

  it('calls dataApiService.get with correct path and query', async () => {
    const mockResults = [{ id: 'r1', content: 'result', score: 0.9 }]
    mockDataApiService.get.mockResolvedValue(mockResults)

    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    let searchResult: unknown
    await act(async () => {
      searchResult = await result.current.search({ search: 'test query' })
    })

    expect(mockDataApiService.get).toHaveBeenCalledWith(`/knowledge-bases/${BASE_ID}/search`, {
      query: { search: 'test query' }
    })
    expect(searchResult).toEqual(mockResults)
  })

  it('manages isSearching state correctly', async () => {
    let resolveGet!: (value: any) => void
    mockDataApiService.get.mockImplementation(() => new Promise((resolve) => (resolveGet = resolve)))

    const { result } = renderHook(() => useKnowledgeSearch(BASE_ID))

    expect(result.current.isSearching).toBe(false)

    let searchPromise: Promise<unknown>
    act(() => {
      searchPromise = result.current.search({ search: 'test' })
    })

    expect(result.current.isSearching).toBe(true)

    await act(async () => {
      resolveGet([])
      await searchPromise!
    })

    expect(result.current.isSearching).toBe(false)
  })
})
