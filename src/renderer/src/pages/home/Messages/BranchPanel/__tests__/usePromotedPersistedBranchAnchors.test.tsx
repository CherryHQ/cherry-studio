import type { BranchAnchor as PersistedBranchAnchorDto } from '@shared/data/types/branchAnchor'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PersistedBranchAnchor } from '../usePersistedBranchAnchors'
import { mergePersistedBranchAnchors, usePromotedPersistedBranchAnchors } from '../usePromotedPersistedBranchAnchors'

function makePersistedAnchorDto(overrides: Partial<PersistedBranchAnchorDto> = {}): PersistedBranchAnchorDto {
  return {
    id: 'anchor-1',
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

function makePersistedAnchor(overrides: Partial<PersistedBranchAnchor> = {}): PersistedBranchAnchor {
  return {
    id: 'anchor-1',
    parentTopicId: 'parent-topic-1',
    branchTopicId: 'branch-topic-1',
    messageId: 'message-1',
    blockId: 'block-1',
    selectedText: 'selected text',
    selectionStart: 2,
    selectionEnd: 15,
    summary: null,
    summaryUpdatedAt: null,
    hydrationStatus: 'unresolved',
    skippedReason: undefined,
    resolvedSelectionStart: undefined,
    resolvedSelectionEnd: undefined,
    ...overrides
  }
}

describe('usePromotedPersistedBranchAnchors', () => {
  it('promotes a newly-created anchor for the active parent topic', () => {
    const { result } = renderHook(() => usePromotedPersistedBranchAnchors('parent-topic-1'))

    act(() => {
      result.current.promoteAnchor(makePersistedAnchorDto({ id: 'anchor-created' }))
    })

    expect(result.current.promotedAnchors).toEqual([
      expect.objectContaining({
        id: 'anchor-created',
        parentTopicId: 'parent-topic-1',
        hydrationStatus: 'unresolved'
      })
    ])
  })

  it('clears promoted anchors and ignores stale create callbacks after active topic changes', () => {
    const { result, rerender } = renderHook(({ parentTopicId }) => usePromotedPersistedBranchAnchors(parentTopicId), {
      initialProps: { parentTopicId: 'parent-topic-1' }
    })

    act(() => {
      result.current.promoteAnchor(makePersistedAnchorDto({ id: 'anchor-old', parentTopicId: 'parent-topic-1' }))
    })
    expect(result.current.promotedAnchors).toHaveLength(1)

    rerender({ parentTopicId: 'parent-topic-2' })
    expect(result.current.promotedAnchors).toEqual([])

    act(() => {
      result.current.promoteAnchor(makePersistedAnchorDto({ id: 'stale-old-topic', parentTopicId: 'parent-topic-1' }))
    })

    expect(result.current.promotedAnchors).toEqual([])
  })

  it('removes a promoted anchor and suppresses a stale server copy after DELETE success', () => {
    const { result } = renderHook(() => usePromotedPersistedBranchAnchors('parent-topic-1'))

    act(() => {
      result.current.promoteAnchor(makePersistedAnchorDto({ id: 'anchor-created' }))
      result.current.removePromotedAnchor('anchor-created')
    })

    expect(result.current.promotedAnchors).toEqual([])
    expect(result.current.suppressedAnchorIds.has('anchor-created')).toBe(true)
    expect(
      mergePersistedBranchAnchors({
        serverAnchors: [makePersistedAnchor({ id: 'anchor-created' })],
        promotedAnchors: result.current.promotedAnchors,
        suppressedAnchorIds: result.current.suppressedAnchorIds
      })
    ).toEqual([])
  })

  it('dedupes server rows when a promoted row has the same id or branchTopicId', () => {
    const merged = mergePersistedBranchAnchors({
      serverAnchors: [
        makePersistedAnchor({ id: 'server-same-id', branchTopicId: 'topic-same-id' }),
        makePersistedAnchor({ id: 'server-same-topic', branchTopicId: 'topic-same' }),
        makePersistedAnchor({ id: 'server-unique', branchTopicId: 'topic-unique' })
      ],
      promotedAnchors: [
        makePersistedAnchor({ id: 'server-same-id', branchTopicId: 'topic-promoted-id' }),
        makePersistedAnchor({ id: 'promoted-same-topic', branchTopicId: 'topic-same' })
      ]
    })

    expect(merged.map((anchor) => anchor.id)).toEqual(['server-unique', 'server-same-id', 'promoted-same-topic'])
  })
})
