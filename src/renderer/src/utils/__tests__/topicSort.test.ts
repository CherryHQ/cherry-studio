import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { sortTopicsByPinnedAndCreatedAt } from '../topicSort'

const makeTopic = (overrides: Partial<Topic> & Pick<Topic, 'id'>): Topic => {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId ?? 'assistant-1',
    name: overrides.name ?? overrides.id,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z',
    messages: overrides.messages ?? [],
    pinned: overrides.pinned
  }
}

describe('sortTopicsByPinnedAndCreatedAt', () => {
  it('优先置顶，其次按创建时间倒序', () => {
    const t1 = makeTopic({ id: 't1', pinned: false, createdAt: '2025-01-01T00:00:00.000Z' })
    const t2 = makeTopic({ id: 't2', pinned: true, createdAt: '2025-01-02T00:00:00.000Z' })
    const t3 = makeTopic({ id: 't3', pinned: true, createdAt: '2024-12-31T00:00:00.000Z' })
    const t4 = makeTopic({ id: 't4', pinned: false, createdAt: '2025-01-03T00:00:00.000Z' })

    const sorted = sortTopicsByPinnedAndCreatedAt([t1, t2, t3, t4])
    expect(sorted.map((t) => t.id)).toEqual(['t2', 't3', 't4', 't1'])
  })

  it('不修改原数组', () => {
    const original = [makeTopic({ id: 'a' }), makeTopic({ id: 'b', pinned: true })]
    const snapshot = original.map((t) => t.id)

    sortTopicsByPinnedAndCreatedAt(original)
    expect(original.map((t) => t.id)).toEqual(snapshot)
  })

  it('创建时间不可用时回退到 updatedAt', () => {
    const t1 = makeTopic({ id: 't1', pinned: true, createdAt: '', updatedAt: '2025-01-03T00:00:00.000Z' })
    const t2 = makeTopic({ id: 't2', pinned: true, createdAt: '2025-01-02T00:00:00.000Z' })

    const sorted = sortTopicsByPinnedAndCreatedAt([t2, t1])
    expect(sorted.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})
