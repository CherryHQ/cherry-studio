import { useReindexKnowledgeItem } from '@renderer/hooks/useKnowledgeItems'
import { createNoteItem } from '@renderer/pages/knowledge/panels/dataSource/__tests__/testUtils'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockIpcRequest = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mockUseInvalidateCache()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mockIpcRequest(...args)
  }
}))

describe('useReindexKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue({ skippedMissingSourceCount: 0 })
  })

  it('reindexes one knowledge item through orchestration IPC and refreshes the list', async () => {
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).resolves.toEqual({ skippedMissingSourceCount: 0 })
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.reindex_items', { baseId: 'base-1', itemIds: ['note-1'] })
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockIpcRequest.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isReindexing).toBe(false)
  })

  it('reindexes multiple knowledge items through one orchestration IPC request and one cache refresh', async () => {
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItems(['note-1', 'note-2'])).resolves.toEqual({ skippedMissingSourceCount: 0 })
    })

    expect(mockIpcRequest).toHaveBeenCalledTimes(1)
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.reindex_items', {
      baseId: 'base-1',
      itemIds: ['note-1', 'note-2']
    })
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1)
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
  })

  it('splits more than 100 items into valid orchestration batches and refreshes once', async () => {
    const itemIds = Array.from({ length: 101 }, (_, index) => `note-${index + 1}`)
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItems(itemIds)).resolves.toEqual({ skippedMissingSourceCount: 0 })
    })

    expect(mockIpcRequest).toHaveBeenCalledTimes(2)
    expect(mockIpcRequest).toHaveBeenNthCalledWith(1, 'knowledge.reindex_items', {
      baseId: 'base-1',
      itemIds: itemIds.slice(0, 100)
    })
    expect(mockIpcRequest).toHaveBeenNthCalledWith(2, 'knowledge.reindex_items', {
      baseId: 'base-1',
      itemIds: itemIds.slice(100)
    })
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1)
    expect(mockIpcRequest.mock.invocationCallOrder[1]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
  })

  it('sums the skipped-source counts across batches so the caller sees the whole selection', async () => {
    const itemIds = Array.from({ length: 101 }, (_, index) => `note-${index + 1}`)
    mockIpcRequest
      .mockResolvedValueOnce({ skippedMissingSourceCount: 3 })
      .mockResolvedValueOnce({ skippedMissingSourceCount: 1 })
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItems(itemIds)).resolves.toEqual({ skippedMissingSourceCount: 4 })
    })
  })

  // Admission rejects a request in which nothing can be rebuilt, and the request is one batch of
  // the user's selection — so on a v1-migrated base a batch of nothing but unbacked folder children
  // must not stop the batches after it, which still hold sources the user asked to refresh.
  it('still sends the later batches when one batch is rejected outright', async () => {
    const itemIds = Array.from({ length: 101 }, (_, index) => `note-${index + 1}`)
    const batchError = new Error('Cannot reindex a knowledge item whose source file or folder no longer exists')
    mockIpcRequest.mockRejectedValueOnce(batchError).mockResolvedValueOnce({ skippedMissingSourceCount: 0 })
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItems(itemIds)).rejects.toBe(batchError)
    })

    expect(mockIpcRequest).toHaveBeenCalledTimes(2)
    expect(mockIpcRequest).toHaveBeenNthCalledWith(2, 'knowledge.reindex_items', {
      baseId: 'base-1',
      itemIds: itemIds.slice(100)
    })
  })

  it('keeps reindex rejected, refreshes items, and exposes inline error when orchestration rejects', async () => {
    const reindexError = new Error('reindex failed')
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockIpcRequest.mockRejectedValueOnce(reindexError)
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).rejects.toBe(reindexError)
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockIpcRequest.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBe(reindexError)
    expect(result.current.isReindexing).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to reindex knowledge source', reindexError, {
      baseId: 'base-1',
      itemIds: ['note-1']
    })
  })
})
