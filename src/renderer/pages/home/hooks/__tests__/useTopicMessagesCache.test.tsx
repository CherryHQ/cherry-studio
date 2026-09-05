import type { BranchMessage, BranchMessagesResponse, Message } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTopicMessagesCache } from '../useTopicMessagesCache'

function message(
  id: string,
  role: Message['role'],
  createdAt: string,
  modelId: string | null = null,
  modelSnapshot?: { id: string; provider: string }
): Message {
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
    messageSnapshot: modelSnapshot
      ? { id: 'assistant-1', name: 'Assistant', model: { ...modelSnapshot, name: modelSnapshot.id } }
      : null,
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

  it('uses snapshots to distinguish replies after both modelIds are removed', () => {
    const selectedReply = message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', null, {
      id: 'model-b',
      provider: 'provider-b'
    })
    const survivingReply = message('answer-a', 'assistant', '2026-08-28T00:00:01.000Z', null, {
      id: 'model-a',
      provider: 'provider-a'
    })
    const branch: BranchMessage[] = [{ message: selectedReply, siblingsGroup: [survivingReply] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set([selectedReply.id]), selectedReply.id)

    expect(nextBranch).toEqual([{ message: survivingReply }])
  })

  it('distinguishes raw snapshot model IDs that contain the provider separator', () => {
    const selectedReply = message('answer-plain', 'assistant', '2026-08-28T00:00:02.000Z', null, {
      id: 'model-a',
      provider: 'provider-a'
    })
    const survivingReply = message('answer-separator', 'assistant', '2026-08-28T00:00:01.000Z', null, {
      id: 'provider-a::model-a',
      provider: 'provider-a'
    })
    const branch: BranchMessage[] = [{ message: selectedReply, siblingsGroup: [survivingReply] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set([selectedReply.id]), selectedReply.id)

    expect(nextBranch).toEqual([{ message: survivingReply }])
  })

  it('falls back to the parent while deleting the latest same-model regeneration', async () => {
    const selectedReply = message('answer-new', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-a::model-a')
    const olderReply = message('answer-old', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a')
    const pages: BranchMessagesResponse[] = [
      branchPage([{ message: selectedReply, siblingsGroup: [olderReply] }], selectedReply.id)
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
      result.current.branchWithoutIds(items, new Set([selectedReply.id]), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages).toEqual([
      expect.objectContaining({
        activeNodeId: selectedReply.parentId,
        items: []
      })
    ])
  })

  it('falls back to the parent while deleting an ungrouped active assistant', async () => {
    const selectedReply = {
      ...message('answer', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a'),
      siblingsGroupId: 0
    }
    const pages: BranchMessagesResponse[] = [branchPage([{ message: selectedReply }], selectedReply.id)]
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
      result.current.branchWithoutIds(items, new Set([selectedReply.id]), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages).toEqual([
      expect.objectContaining({
        activeNodeId: selectedReply.parentId,
        items: []
      })
    ])
  })

  it('clears the active node when its optimistic parent is the virtual root', async () => {
    const selectedReply = {
      ...message('answer', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a'),
      parentId: 'root-1',
      siblingsGroupId: 0
    }
    const pages: BranchMessagesResponse[] = [branchPage([{ message: selectedReply }], selectedReply.id)]
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
      result.current.branchWithoutIds(items, new Set([selectedReply.id]), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages).toEqual([
      expect.objectContaining({
        activeNodeId: null,
        items: []
      })
    ])
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

  it('reparents a retained descendant across pages when its historical parent is removed', async () => {
    const historicalParent = {
      ...message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b'),
      parentId: 'question-1'
    }
    const activeDescendant = {
      ...message('follow-up', 'user', '2026-08-28T00:00:03.000Z'),
      parentId: historicalParent.id,
      siblingsGroupId: 0
    }
    const pages = [
      branchPage([{ message: activeDescendant }], activeDescendant.id),
      branchPage([{ message: historicalParent }], activeDescendant.id)
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
      result.current.branchWithoutIds(items, new Set([historicalParent.id]), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    expect(nextPages?.[0]?.items).toEqual([{ message: { ...activeDescendant, parentId: historicalParent.parentId } }])
    expect(nextPages?.[1]?.items).toEqual([])
  })

  it('rebases a moved sibling group so it cannot collide at the destination parent', async () => {
    const historicalParent = {
      ...message('answer-b', 'assistant', '2026-08-28T00:00:02.000Z', 'provider-b::model-b'),
      parentId: 'question-1',
      siblingsGroupId: 0
    }
    const destinationReply = {
      ...message('answer-a', 'assistant', '2026-08-28T00:00:01.000Z', 'provider-a::model-a'),
      parentId: historicalParent.parentId,
      siblingsGroupId: 5
    }
    const movedUser = {
      ...message('follow-up-b', 'user', '2026-08-28T00:00:04.000Z'),
      parentId: historicalParent.id,
      siblingsGroupId: 5
    }
    const movedSibling = {
      ...message('follow-up-a', 'user', '2026-08-28T00:00:03.000Z'),
      parentId: historicalParent.id,
      siblingsGroupId: 5
    }
    const pages = [
      branchPage([{ message: movedUser, siblingsGroup: [movedSibling] }], movedUser.id),
      branchPage([{ message: historicalParent }, { message: destinationReply }], movedUser.id)
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
      result.current.branchWithoutIds(items, new Set([historicalParent.id]), activeNodeId)
    )

    const nextPages = await mutate.mock.results[0]?.value
    const movedGroup = nextPages?.[0]?.items[0]
    expect(movedGroup?.message.parentId).toBe(historicalParent.parentId)
    expect(movedGroup?.siblingsGroup?.[0]?.parentId).toBe(historicalParent.parentId)
    expect(movedGroup?.message.siblingsGroupId).toBe(movedGroup?.siblingsGroup?.[0]?.siblingsGroupId)
    expect(movedGroup?.message.siblingsGroupId).not.toBe(destinationReply.siblingsGroupId)
    expect(nextPages?.[1]?.items).toEqual([{ message: destinationReply }])
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
