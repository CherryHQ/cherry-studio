import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { AbsoluteFilePath } from '@shared/types/file'

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

describe('useAddKnowledgeItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockInvalidateCache.mockResolvedValue(undefined)
    mockIpcRequest.mockResolvedValue({ status: 'added' })
  })

  it('submits knowledge sources through orchestration IPC and refreshes the list', async () => {
    const items = [
      {
        type: 'directory' as const,
        data: {
          source: '/Users/me/docs'
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
      await expect(result.current.submit(items)).resolves.toEqual({ status: 'added' })
    })

    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.add_items', { baseId: 'base-1', items })
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
    expect(result.current.error).toBeUndefined()
    expect(result.current.isSubmitting).toBe(false)
  })

  it('returns the conflicts result and skips the list refresh when the add reports conflicts', async () => {
    const conflictsResult = { status: 'conflicts' as const, conflicts: [{ type: 'note' as const, title: 'Doc A' }] }
    mockIpcRequest.mockResolvedValueOnce(conflictsResult)
    const items = [{ type: 'note' as const, data: { source: 'Doc A', content: 'Doc A' } }]

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    let submitResult: unknown
    await act(async () => {
      submitResult = await result.current.submit(items, 'detect')
    })

    expect(submitResult).toEqual(conflictsResult)
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.add_items', {
      baseId: 'base-1',
      items,
      conflictStrategy: 'detect'
    })
    // Nothing was added, so the list cache is not refreshed.
    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(result.current.error).toBeUndefined()
    expect(result.current.isSubmitting).toBe(false)
  })

  it('keeps submit rejected, refreshes items, and exposes inline error when orchestration rejects', async () => {
    const submitError = new Error('create failed')
    mockIpcRequest.mockRejectedValueOnce(submitError)

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
    mockIpcRequest.mockRejectedValueOnce(submitError)
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

  it('submits a detect batch larger than 20 files in one atomic call', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      type: 'file' as const,
      data: {
        source: `/docs/doc-${index}.pdf`,
        path: `/docs/doc-${index}.pdf` as AbsoluteFilePath
      }
    }))

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(result.current.submit(items, 'detect')).resolves.toEqual({ status: 'added' })
    })

    // Atomic conflict detection spans the whole batch: one call, no silent cap.
    expect(mockIpcRequest).toHaveBeenCalledTimes(1)
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.add_items', {
      baseId: 'base-1',
      items,
      conflictStrategy: 'detect'
    })
    expect(mockInvalidateCache).toHaveBeenCalledWith(['/knowledge-bases/base-1/items', '/knowledge-bases'])
  })

  it('chunks a rename resolution larger than the transport limit without dropping files', async () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      type: 'file' as const,
      data: {
        source: `/docs/doc-${index}.pdf`,
        path: `/docs/doc-${index}.pdf` as AbsoluteFilePath
      }
    }))

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(result.current.submit(items, 'rename')).resolves.toEqual({ status: 'added' })
    })

    expect(mockIpcRequest).toHaveBeenCalledTimes(2)
    expect(mockIpcRequest.mock.calls[0][1]).toEqual({
      baseId: 'base-1',
      items: items.slice(0, 100),
      conflictStrategy: 'rename'
    })
    expect(mockIpcRequest.mock.calls[1][1]).toEqual({
      baseId: 'base-1',
      items: items.slice(100),
      conflictStrategy: 'rename'
    })
  })

  it('submits a replace resolution larger than the transport limit in one atomic call', async () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      type: 'file' as const,
      data: {
        source: `/docs/doc-${index}.pdf`,
        path: `/docs/doc-${index}.pdf` as AbsoluteFilePath
      }
    }))

    const { result } = renderHook(() => useAddKnowledgeItems('base-1'))

    await act(async () => {
      await expect(result.current.submit(items, 'replace')).resolves.toEqual({ status: 'added' })
    })

    // Replace purges existing conflicts before reserving names: chunking it
    // would let a later chunk purge an earlier chunk's auto-renamed admission.
    expect(mockIpcRequest).toHaveBeenCalledTimes(1)
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.add_items', {
      baseId: 'base-1',
      items,
      conflictStrategy: 'replace'
    })
  })
})
