import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { projectPersistedBranchAnchorCandidates } from '../persistedAnchorProjection'
import type { Branch } from '../types'
import type { PersistedBranchAnchor } from '../usePersistedBranchAnchors'

function topic(id: string): Topic {
  return { id, name: id, assistantId: 'assistant-1' } as Topic
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 'live-branch-1',
    source: {
      messageId: 'message-1',
      blockId: 'block-1',
      selectedText: 'selected text',
      offsets: { start: 2, end: 15 }
    },
    topic: topic('live-topic-1'),
    createdAt: 1,
    color: 'c1',
    disposition: 'kept',
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
    selectionStart: 2,
    selectionEnd: 15,
    selectedText: 'selected text',
    summary: null,
    summaryUpdatedAt: null,
    hydrationStatus: 'unresolved',
    skippedReason: undefined,
    resolvedSelectionStart: undefined,
    resolvedSelectionEnd: undefined,
    ...overrides
  }
}

describe('projectPersistedBranchAnchorCandidates', () => {
  it('projects persisted anchors into deterministic DOM paint candidates', () => {
    expect(
      projectPersistedBranchAnchorCandidates({
        persistedAnchors: [makePersistedAnchor({ id: 'anchor-1' })],
        branches: []
      })
    ).toEqual([
      {
        id: 'anchor-1',
        branchTopicId: 'branch-topic-1',
        branchId: 'persisted:anchor-1',
        blockId: 'block-1',
        selectedText: 'selected text',
        selectionStart: 2,
        selectionEnd: 15,
        color: 'c1'
      }
    ])
  })

  it('skips persisted anchors whose branchTopicId already has a live branch topic', () => {
    expect(
      projectPersistedBranchAnchorCandidates({
        persistedAnchors: [
          makePersistedAnchor({ id: 'anchor-live', branchTopicId: 'live-topic-1' }),
          makePersistedAnchor({ id: 'anchor-persisted', branchTopicId: 'persisted-topic-1' })
        ],
        branches: [makeBranch({ topic: topic('live-topic-1') })]
      })
    ).toEqual([
      expect.objectContaining({
        id: 'anchor-persisted',
        branchId: 'persisted:anchor-persisted',
        branchTopicId: 'persisted-topic-1'
      })
    ])
  })

  it('filters a promoted persisted anchor while its live branch is open, then projects it after close', () => {
    const promotedAnchor = makePersistedAnchor({
      id: 'promoted-anchor-1',
      branchTopicId: 'live-topic-1'
    })

    expect(
      projectPersistedBranchAnchorCandidates({
        persistedAnchors: [promotedAnchor],
        branches: [makeBranch({ topic: topic('live-topic-1') })]
      })
    ).toEqual([])

    expect(
      projectPersistedBranchAnchorCandidates({
        persistedAnchors: [promotedAnchor],
        branches: []
      })
    ).toEqual([
      expect.objectContaining({
        id: 'promoted-anchor-1',
        branchId: 'persisted:promoted-anchor-1',
        branchTopicId: 'live-topic-1'
      })
    ])
  })

  it('assigns persisted colors after currently-live branch colors', () => {
    const candidates = projectPersistedBranchAnchorCandidates({
      persistedAnchors: [
        makePersistedAnchor({ id: 'anchor-1', branchTopicId: 'topic-1' }),
        makePersistedAnchor({ id: 'anchor-2', branchTopicId: 'topic-2' })
      ],
      branches: [makeBranch({ color: 'c1' }), makeBranch({ id: 'live-branch-2', color: 'c3' })]
    })

    expect(candidates.map((candidate) => candidate.color)).toEqual(['c2', 'c4'])
  })

  it('does not treat compose-state branches as persisted duplicates', () => {
    expect(
      projectPersistedBranchAnchorCandidates({
        persistedAnchors: [makePersistedAnchor({ branchTopicId: 'branch-topic-1' })],
        branches: [makeBranch({ topic: null })]
      })
    ).toHaveLength(1)
  })
})
