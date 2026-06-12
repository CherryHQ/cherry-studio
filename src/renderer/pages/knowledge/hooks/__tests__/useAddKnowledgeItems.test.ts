import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseInvalidateCache = vi.fn()
const mockInvalidateCache = vi.fn()
const mockAddItems = vi.fn()
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mockUseInvalidateCache()
}))

describe('useAddKnowledgeItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockAddItems.mockResolvedValue(undefined)
    ;(window as any).api = {
      knowledge: {
        addItems: mockAddItems
      }
    }
  })

  it('submits knowledge sources through orchestration IPC and refreshes the list', async () => {
    const items = [
      {
        type: 'directory' as const,
        data: {
          source: '/Users/me/docs',
          path: '/Users/me/docs'
        }
      },
      {
        type: 'url' as const,
        data: {
          source: 'https://example.com/article',
          url: 'https://example.com/article'
        }
      }
    ]

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(result.current.submit(items)).resolves.toBeUndefined()
    })

    expect(mockAddItems).toHaveBeenCalledWith('base-1', items)
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isSubmitting).toBe(false)
  })

  it('keeps submit rejected, refreshes items, and exposes inline error when orchestration rejects', async () => {
    const submitError = new Error('create failed')
    mockAddItems.mockRejectedValueOnce(submitError)

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(
        result.current.submit([
          {
            type: 'url' as const,
            data: {
              source: 'https://example.com/article',
              url: 'https://example.com/article'
            }
          }
        ])
      ).rejects.toBe(submitError)
    })

    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(result.current.error).toBe(submitError)
    expect(result.current.isSubmitting).toBe(false)
    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to add knowledge sources', submitError, {
      baseId: 'base-1',
      sourceCount: 1
    })
  })

  it('preserves the submit rejection when post-failure refresh also fails', async () => {
    const submitError = new Error('create failed')
    const invalidateError = new Error('refresh failed')
    mockAddItems.mockRejectedValueOnce(submitError)
    mockInvalidateCache.mockRejectedValueOnce(invalidateError)

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(
        result.current.submit([
          {
            type: 'url' as const,
            data: {
              source: 'https://example.com/article',
              url: 'https://example.com/article'
            }
          }
        ])
      ).rejects.toBe(submitError)
    })

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to refresh knowledge source list after submit',
      invalidateError,
      {
        baseId: 'base-1'
      }
    )
  })
})
