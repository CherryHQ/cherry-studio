import { useQuery } from '@data/hooks/useDataApi'
import type { BranchAnchor as PersistedBranchAnchorDto } from '@shared/data/types/branchAnchor'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePersistedBranchAnchors } from '../usePersistedBranchAnchors'

const ENDPOINT = '/topics/:id/branch-anchors'

function makePersistedAnchor(overrides: Partial<PersistedBranchAnchorDto> = {}): PersistedBranchAnchorDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    parentTopicId: 'parent-topic-1',
    branchTopicId: 'branch-topic-1',
    messageId: 'message-1',
    blockId: 'block-1',
    selectedText: 'selected text',
    selectionStart: 2,
    selectionEnd: 15,
    disposition: 'kept',
    summary: null,
    summaryUpdatedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('usePersistedBranchAnchors (P2 Step 2C)', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('calls GET /topics/:id/branch-anchors with the active parentTopicId', () => {
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, { data: [] })

    renderHook(() => usePersistedBranchAnchors('parent-topic-1'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(ENDPOINT, {
      params: { id: 'parent-topic-1' },
      enabled: true,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('returns empty anchors for zero rows', () => {
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, { data: [] })

    const { result } = renderHook(() => usePersistedBranchAnchors('parent-topic-1'))

    expect(result.current.anchors).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it("normalizes valid rows to hydrationStatus 'unresolved'", () => {
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, {
      data: [
        makePersistedAnchor({
          summary: 'Branch summary',
          summaryUpdatedAt: '2026-07-01T00:01:00.000Z'
        })
      ]
    })

    const { result } = renderHook(() => usePersistedBranchAnchors('parent-topic-1'))

    expect(result.current.anchors).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        parentTopicId: 'parent-topic-1',
        branchTopicId: 'branch-topic-1',
        messageId: 'message-1',
        blockId: 'block-1',
        selectionStart: 2,
        selectionEnd: 15,
        selectedText: 'selected text',
        summary: 'Branch summary',
        summaryUpdatedAt: '2026-07-01T00:01:00.000Z',
        hydrationStatus: 'unresolved',
        skippedReason: undefined,
        resolvedSelectionStart: undefined,
        resolvedSelectionEnd: undefined
      }
    ])
  })

  it('exposes GET failures without throwing through render', () => {
    const error = new Error('network down')
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, { data: undefined, error })

    const { result } = renderHook(() => usePersistedBranchAnchors('parent-topic-1'))

    expect(result.current.anchors).toEqual([])
    expect(result.current.error).toBe(error)
  })

  it('clears old parent rows when parentTopicId changes', () => {
    vi.mocked(useQuery).mockImplementation((_path, options) => {
      const parentTopicId = (options as { params?: { id?: string } } | undefined)?.params?.id
      const data =
        parentTopicId === 'parent-topic-1'
          ? [makePersistedAnchor({ parentTopicId: 'parent-topic-1' })]
          : [makePersistedAnchor({ parentTopicId: 'parent-topic-1', branchTopicId: 'stale-branch-topic' })]

      return {
        data,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(data),
        mutate: vi.fn().mockResolvedValue(data)
      }
    })

    const { result, rerender } = renderHook(({ parentTopicId }) => usePersistedBranchAnchors(parentTopicId), {
      initialProps: { parentTopicId: 'parent-topic-1' }
    })

    expect(result.current.anchors).toHaveLength(1)

    rerender({ parentTopicId: 'parent-topic-2' })

    expect(result.current.anchors).toEqual([])
    expect(vi.mocked(useQuery)).toHaveBeenLastCalledWith(
      ENDPOINT,
      expect.objectContaining({
        params: { id: 'parent-topic-2' },
        enabled: true,
        swrOptions: { keepPreviousData: false }
      })
    )
  })

  it('disables the GET when parentTopicId is missing and returns empty anchors', () => {
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, { data: [makePersistedAnchor()] })

    const { result } = renderHook(() => usePersistedBranchAnchors(null))

    expect(result.current.anchors).toEqual([])
    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(ENDPOINT, {
      params: { id: '' },
      enabled: false,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('exposes refetch from the DataApi query result', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult(ENDPOINT, { data: [], refetch })

    const { result } = renderHook(() => usePersistedBranchAnchors('parent-topic-1'))

    void result.current.refetch()
    expect(refetch).toHaveBeenCalled()
  })
})
