import type { Topic } from '@renderer/types'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBranchAnchorWriteGuardForTest } from '../branchAnchorWrite'
import type { Branch } from '../types'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  createBranchAnchor: vi.fn(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: mocks.loggerDebug,
      error: mocks.loggerError
    })
  }
}))

import { useBranchAnchorPersistence } from '../useBranchAnchorPersistence'

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

function renderPersistence(branches: Branch[]) {
  return renderHook(
    ({ currentBranches }) => useBranchAnchorPersistence({ parentTopicId: 'parent-topic-1', branches: currentBranches }),
    { initialProps: { currentBranches: branches } }
  )
}

describe('useBranchAnchorPersistence (P2 Step 2A)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBranchAnchorWriteGuardForTest()
    mocks.createBranchAnchor.mockResolvedValue({ id: 'anchor-1' })
    mocks.useMutation.mockReturnValue({
      trigger: mocks.createBranchAnchor,
      isLoading: false,
      error: undefined
    })
  })

  it('creates a branch_anchor once for a kept branch with a forked topic', async () => {
    renderPersistence([makeBranch()])

    await waitFor(() => expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1))
    expect(mocks.createBranchAnchor).toHaveBeenCalledWith({
      body: {
        parentTopicId: 'parent-topic-1',
        branchTopicId: 'branch-topic-1',
        messageId: 'message-1',
        blockId: 'block-1',
        selectedText: 'selected text',
        selectionStart: 2,
        selectionEnd: 15
      }
    })
  })

  it('handles keep-before-fork: waits until the branch topic exists', async () => {
    const keptComposeBranch = makeBranch({ topic: null, disposition: 'kept' })
    const { rerender } = renderPersistence([keptComposeBranch])

    expect(mocks.createBranchAnchor).not.toHaveBeenCalled()

    rerender({ currentBranches: [{ ...keptComposeBranch, topic: topic('branch-topic-1') }] })

    await waitFor(() => expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1))
  })

  it('handles fork-before-keep: waits until disposition becomes kept', async () => {
    const pendingForkedBranch = makeBranch({ disposition: 'pending' })
    const { rerender } = renderPersistence([pendingForkedBranch])

    expect(mocks.createBranchAnchor).not.toHaveBeenCalled()

    rerender({ currentBranches: [{ ...pendingForkedBranch, disposition: 'kept' }] })

    await waitFor(() => expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1))
  })

  it('does not create duplicate anchors across repeated kept states for the same branchTopicId', async () => {
    const keptBranch = makeBranch({ disposition: 'kept' })
    const { rerender } = renderPersistence([keptBranch])

    await waitFor(() => expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1))

    rerender({ currentBranches: [{ ...keptBranch, disposition: 'pending' }] })
    rerender({ currentBranches: [{ ...keptBranch, disposition: 'kept' }] })
    rerender({ currentBranches: [makeBranch({ id: 'branch-duplicate-ui', topic: topic('branch-topic-1') })] })

    expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1)
  })

  it('does not create anchors for pending discard/removal', () => {
    const pendingBranch = makeBranch({ disposition: 'pending' })
    const { rerender } = renderPersistence([pendingBranch])

    rerender({ currentBranches: [] })

    expect(mocks.createBranchAnchor).not.toHaveBeenCalled()
  })

  it('does not call POST when payload validation fails', () => {
    renderPersistence([makeBranch({ source: { ...makeBranch().source, offsets: { start: 4, end: 4 } } })])

    expect(mocks.createBranchAnchor).not.toHaveBeenCalled()
  })

  it('catches API failure without throwing through the hook render path', async () => {
    const error = new Error('network down')
    mocks.createBranchAnchor.mockRejectedValue(error)

    renderPersistence([makeBranch()])

    await waitFor(() => expect(mocks.createBranchAnchor).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalledWith(expect.any(String), error, expect.any(Object)))
  })
})
