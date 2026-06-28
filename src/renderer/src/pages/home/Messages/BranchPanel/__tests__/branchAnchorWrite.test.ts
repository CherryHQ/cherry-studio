import type { Topic } from '@renderer/types'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildCreateBranchAnchorBody,
  canWriteBranchAnchor,
  resetBranchAnchorWriteGuardForTest,
  shouldWriteBranchAnchorOnce
} from '../branchAnchorWrite'
import type { Branch } from '../types'

function topic(id: string): Topic {
  return { id, name: id, assistantId: 'assistant-1' } as Topic
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 'branch-1',
    source: {
      messageId: 'message-1',
      blockId: 'block-1',
      selectedText: 'selected text',
      offsets: { start: 2, end: 15 }
    },
    topic: topic('branch-topic-1'),
    createdAt: 1,
    color: 'c1',
    disposition: 'kept',
    ...overrides
  }
}

describe('branchAnchorWrite (P2 Step 2A)', () => {
  beforeEach(() => {
    resetBranchAnchorWriteGuardForTest()
  })

  it('canWriteBranchAnchor requires kept disposition and a forked topic id', () => {
    expect(canWriteBranchAnchor(makeBranch())).toBe(true)
    expect(canWriteBranchAnchor(makeBranch({ disposition: 'pending' }))).toBe(false)
    expect(canWriteBranchAnchor(makeBranch({ topic: null }))).toBe(false)
    expect(canWriteBranchAnchor(makeBranch({ topic: { id: '' } as Topic }))).toBe(false)
  })

  it('shouldWriteBranchAnchorOnce claims once by stable branchTopicId', () => {
    const branch = makeBranch({ id: 'branch-A', topic: topic('topic-same') })
    expect(shouldWriteBranchAnchorOnce(branch)).toBe(true)
    expect(shouldWriteBranchAnchorOnce(branch)).toBe(false)

    const duplicateUiBranch = makeBranch({ id: 'branch-B', topic: topic('topic-same') })
    expect(shouldWriteBranchAnchorOnce(duplicateUiBranch)).toBe(false)

    const differentTopic = makeBranch({ id: 'branch-C', topic: topic('topic-other') })
    expect(shouldWriteBranchAnchorOnce(differentTopic)).toBe(true)
  })

  it('does not claim pending or compose-state branches', () => {
    expect(shouldWriteBranchAnchorOnce(makeBranch({ disposition: 'pending' }))).toBe(false)
    expect(shouldWriteBranchAnchorOnce(makeBranch({ topic: null }))).toBe(false)
  })

  it('buildCreateBranchAnchorBody returns the validated create DTO', () => {
    expect(buildCreateBranchAnchorBody('parent-topic-1', makeBranch())).toEqual({
      parentTopicId: 'parent-topic-1',
      branchTopicId: 'branch-topic-1',
      messageId: 'message-1',
      blockId: 'block-1',
      selectedText: 'selected text',
      selectionStart: 2,
      selectionEnd: 15
    })
  })

  it('buildCreateBranchAnchorBody rejects invalid schema payloads', () => {
    expect(buildCreateBranchAnchorBody('', makeBranch())).toBeNull()
    expect(buildCreateBranchAnchorBody('parent-topic-1', makeBranch({ disposition: 'pending' }))).toBeNull()
    expect(
      buildCreateBranchAnchorBody(
        'parent-topic-1',
        makeBranch({ source: { ...makeBranch().source, selectedText: '' } })
      )
    ).toBeNull()
    expect(
      buildCreateBranchAnchorBody(
        'parent-topic-1',
        makeBranch({ source: { ...makeBranch().source, offsets: { start: 3, end: 3 } } })
      )
    ).toBeNull()
    expect(
      buildCreateBranchAnchorBody(
        'parent-topic-1',
        makeBranch({ source: { ...makeBranch().source, offsets: { start: -1, end: 3 } } })
      )
    ).toBeNull()
  })
})
