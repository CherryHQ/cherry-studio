import type { Topic } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_BRANCH_DISPOSITION, disposeBranchTopicOnClose, toggleDisposition } from '../branchDisposition'
import type { Branch } from '../types'

function makeBranch(over: Partial<Branch>): Branch {
  return {
    id: 'branch-A',
    source: { messageId: 'm', blockId: 'b', selectedText: 's', offsets: { start: 0, end: 1 } },
    topic: { id: 'topic-fork-1' } as Topic,
    createdAt: 1,
    color: 'c1',
    disposition: 'pending',
    ...over
  }
}

describe('branchDisposition (P1-S3)', () => {
  it('default disposition on create is pending', () => {
    expect(DEFAULT_BRANCH_DISPOSITION).toBe('pending')
  })

  it('toggleDisposition flips pending ↔ kept', () => {
    expect(toggleDisposition('pending')).toBe('kept')
    expect(toggleDisposition('kept')).toBe('pending')
  })

  it('close PENDING → deletes the fork topic (delete called with the fork topic id)', () => {
    const del = vi.fn()
    disposeBranchTopicOnClose(makeBranch({ disposition: 'pending' }), del)
    expect(del).toHaveBeenCalledExactlyOnceWith('topic-fork-1')
  })

  it('close KEPT → does NOT delete the fork topic', () => {
    const del = vi.fn()
    disposeBranchTopicOnClose(makeBranch({ disposition: 'kept' }), del)
    expect(del).not.toHaveBeenCalled()
  })

  it('compose-state branch (no fork topic) deletes nothing even when pending', () => {
    const del = vi.fn()
    disposeBranchTopicOnClose(makeBranch({ topic: null, disposition: 'pending' }), del)
    expect(del).not.toHaveBeenCalled()
  })
})
