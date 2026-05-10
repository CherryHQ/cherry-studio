import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRendererLoggerService } from '../../../../../../../tests/__mocks__/RendererLoggerService'
import { createNoteItem } from '../../panels/dataSource/__tests__/testUtils'
import { useReindexKnowledgeItem } from '../useReindexKnowledgeItem'

const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockReindexItems = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mockUseInvalidateCache()
}))

describe('useReindexKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockReindexItems.mockResolvedValue(undefined)
    ;(window as any).api = {
      knowledgeRuntime: {
        reindexItems: mockReindexItems
      }
    }
  })

  it('reindexes one knowledge item through orchestration IPC and refreshes the list', async () => {
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).resolves.toBeUndefined()
    })

    expect(mockReindexItems).toHaveBeenCalledWith('base-1', ['note-1'])
    expect(mockInvalidateCache).toHaveBeenCalledWith('/knowledge-bases/base-1/items')
    expect(result.current.error).toBeUndefined()
    expect(result.current.isReindexing).toBe(false)
  })

  it('keeps reindex rejected and exposes inline error when orchestration rejects', async () => {
    const reindexError = new Error('reindex failed')
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })
    mockReindexItems.mockRejectedValueOnce(reindexError)
    const { result } = renderHook(() => useReindexKnowledgeItem('base-1'))

    await act(async () => {
      await expect(result.current.reindexItem(item)).rejects.toBe(reindexError)
    })

    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.error).toBe(reindexError)
    expect(result.current.isReindexing).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to reindex knowledge source', reindexError, {
      baseId: 'base-1',
      itemId: 'note-1'
    })
  })
})
