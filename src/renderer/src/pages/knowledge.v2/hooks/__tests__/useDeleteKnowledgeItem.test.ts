import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../../tests/__mocks__/RendererLoggerService'
import { createNoteItem } from '../../panels/dataSource/__tests__/testUtils'
import { useDeleteKnowledgeItem } from '../useDeleteKnowledgeItem'

const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockDeleteItems = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mockUseInvalidateCache()
}))

describe('useDeleteKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockDeleteItems.mockResolvedValue({ itemIds: ['note-1'] })
    ;(window as any).api = {
      knowledgeRuntime: {
        deleteItems: mockDeleteItems
      }
    }
  })

  it('deletes one knowledge item through runtime IPC and refreshes the list', async () => {
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    const { result } = renderHook(() => useDeleteKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.deleteItem(item)).resolves.toBeUndefined()
    })

    expect(mockDeleteItems).toHaveBeenCalledWith('base-1', ['note-1'])
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
    expect(result.current.error).toBeUndefined()
    expect(result.current.isDeleting).toBe(false)
  })

  it('keeps delete rejected and exposes inline error when runtime IPC rejects', async () => {
    const deleteError = new Error('delete failed')
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockDeleteItems.mockRejectedValueOnce(deleteError)
    const { result } = renderHook(() => useDeleteKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.deleteItem(item)).rejects.toBe(deleteError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.error).toBe(deleteError)
    expect(result.current.isDeleting).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to delete knowledge source', {
      baseId: 'base-1',
      itemId: 'note-1',
      error: deleteError
    })
  })
})
