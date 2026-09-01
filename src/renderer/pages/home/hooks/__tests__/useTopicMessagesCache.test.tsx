import type { BranchMessage, BranchMessagesResponse, Message } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTopicMessagesCache } from '../useTopicMessagesCache'

function message(id: string, role: Message['role'], createdAt: string, modelId: string | null = null): Message {
  return {
    id,
    topicId: 'topic-1',
    parentId: 'user-1',
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 1,
    modelId,
    messageSnapshot: null,
    stats: null,
    createdAt,
    updatedAt: createdAt
  }
}

function branchPage(items: BranchMessage[], activeNodeId: string | null): BranchMessagesResponse {
  return {
    items,
    nextCursor: undefined,
    activeNodeId,
    assistantId: 'assistant-1',
    rootId: 'root-1'
  }
}

describe('useTopicMessagesCache', () => {
  it('promotes the newest surviving model reply when the selected representative is removed', () => {
    const selectedReply = message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b')
    const olderReply = message('answer-a', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a')
    const newestReply = message('answer-c', 'assistant', '2026-08-28T00:00:03.000Z', 'provider-c::model-c')
    const branch: BranchMessage[] = [{ message: selectedReply, siblingsGroup: [olderReply, newestReply] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set(['answer-b']), 'answer-b')

    expect(nextBranch).toEqual([{ message: newestReply, siblingsGroup: [olderReply] }])
  })

  it('does not promote a grouped reply when a historical representative is removed', () => {
    const historicalReply = message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b')
    const offPathReply = message('answer-a', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a')
    const branch: BranchMessage[] = [{ message: historicalReply, siblingsGroup: [offPathReply] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set(['answer-b']), 'active-descendant')

    expect(nextBranch).toEqual([])
  })

  it('does not promote an off-path user sibling when the selected user branch is removed', () => {
    const selectedUser = message('question-b', 'user', '2026-08-28T00:00:02.000Z')
    const offPathUser = message('question-a', 'user', '2026-08-28T00:00:01.000Z')
    const branch: BranchMessage[] = [{ message: selectedUser, siblingsGroup: [offPathUser] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set(['question-b']), 'question-b')

    expect(nextBranch).toEqual([])
  })

  it('updates page.activeNodeId to the promoted sibling during optimistic grouped-assistant delete', async () => {
    const selectedReply = message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b')
    const olderReply = message('answer-a', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a')
    const newestReply = message('answer-c', 'assistant', '2026-08-28T00:00:03.000Z', 'provider-c::model-c')
    const pages: BranchMessagesResponse[] = [
      branchPage([{ message: selectedReply, siblingsGroup: [olderReply, newestReply] }], 'answer-b')
    ]
    const mutate = vi.fn(async (updater?: unknown) => {
      if (typeof updater === 'function') {
        return (updater as (current: BranchMessagesResponse[] | undefined) => BranchMessagesResponse[] | undefined)(
          pages
        )
      }
      return pages
    })
    const { result } = renderHook(() => useTopicMessagesCache({ topicId: 'topic-1', mutate }))

    await result.current.seedOptimisticBranch((items, activeNodeId) =>
      result.current.branchWithoutIds(items, new Set(['answer-b']), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages).toEqual([
      expect.objectContaining({
        activeNodeId: 'answer-c',
        items: [{ message: newestReply, siblingsGroup: [olderReply] }]
      })
    ])
  })

  it('does not invent page.activeNodeId when the deleted message was not active', async () => {
    const activeReply = message('answer-c', 'assistant', '2026-08-28T00:00:03.000Z', 'provider-c::model-c')
    const siblingReply = message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b')
    const pages: BranchMessagesResponse[] = [
      branchPage([{ message: activeReply, siblingsGroup: [siblingReply] }], 'answer-c')
    ]
    const mutate = vi.fn(async (updater?: unknown) => {
      if (typeof updater === 'function') {
        return (updater as (current: BranchMessagesResponse[] | undefined) => BranchMessagesResponse[] | undefined)(
          pages
        )
      }
      return pages
    })
    const { result } = renderHook(() => useTopicMessagesCache({ topicId: 'topic-1', mutate }))

    await result.current.seedOptimisticBranch((items, activeNodeId) =>
      result.current.branchWithoutIds(items, new Set(['answer-b']), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages).toEqual([
      expect.objectContaining({
        activeNodeId: 'answer-c',
        items: [{ message: activeReply, siblingsGroup: [] }]
      })
    ])
  })
})
