import type { BranchMessage, Message } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTopicMessagesCache } from '../useTopicMessagesCache'

function assistantMessage(id: string, modelId: string): Message {
  return {
    id,
    topicId: 'topic-1',
    parentId: 'user-1',
    role: 'assistant',
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 1,
    modelId,
    messageSnapshot: null,
    stats: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z'
  }
}

describe('useTopicMessagesCache', () => {
  it('promotes a surviving model reply when the selected representative is removed', () => {
    const selectedReply = assistantMessage('answer-b', 'provider-b::model-b')
    const survivingReply = assistantMessage('answer-a', 'provider-a::model-a')
    const branch: BranchMessage[] = [{ message: selectedReply, siblingsGroup: [survivingReply] }]
    const { result } = renderHook(() =>
      useTopicMessagesCache({ topicId: 'topic-1', mutate: vi.fn().mockResolvedValue(undefined) })
    )

    const nextBranch = result.current.branchWithoutIds(branch, new Set(['answer-b']))

    expect(nextBranch).toEqual([{ message: survivingReply }])
  })
})
