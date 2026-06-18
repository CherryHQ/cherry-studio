import { useDeleteKnowledgeItem } from '@renderer/hooks/useKnowledgeItems'
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

describe('useDeleteKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue(undefined)
  })

  it('deletes one knowledge item through runtime IPC and refreshes the list', async () => {
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    const { result } = renderHook(() => useDeleteKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.deleteItem(item)).resolves.toBeUndefined()
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.delete_items', { baseId: 'base-1', itemIds: ['note-1'] })
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockIpcRequest.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isDeleting).toBe(false)
  })

  it('keeps delete rejected, refreshes items, and exposes inline error when runtime IPC rejects', async () => {
    const deleteError = new Error('delete failed')
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockIpcRequest.mockRejectedValueOnce(deleteError)
    const { result } = renderHook(() => useDeleteKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.deleteItem(item)).rejects.toBe(deleteError)
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(mockIpcRequest.mock.invocationCallOrder[0]).toBeLessThan(mockInvalidateCache.mock.invocationCallOrder[0])
    expect(result.current.error).toBe(deleteError)
    expect(result.current.isDeleting).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to delete knowledge source', deleteError, {
      baseId: 'base-1',
      itemId: 'note-1'
    })
  })
})
