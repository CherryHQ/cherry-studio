import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { describe, expect, it } from 'vitest'

import { EMPTY_TOPIC_LIST_ITEM_RECONCILIATION, reconcileTopicListItems } from '../topicListItemSharing'

const createTopic = (overrides: Partial<ApiTopic> = {}): ApiTopic => ({
  id: 'topic-1',
  name: 'Topic',
  isNameManuallyEdited: false,
  orderKey: 'a0',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('reconcileTopicListItems', () => {
  it('reuses unchanged rows when one topic changes or the list is reordered', () => {
    const topicA = createTopic({ id: 'topic-a', name: 'Topic A' })
    const topicB = createTopic({ id: 'topic-b', name: 'Topic B' })
    const isPinned = (id: string) => id === topicB.id
    const initial = reconcileTopicListItems([topicA, topicB], isPinned, EMPTY_TOPIC_LIST_ITEM_RECONCILIATION)

    const updated = reconcileTopicListItems(
      [{ ...topicB, lastActivityAt: '2026-01-02T00:00:00.000Z' }, { ...topicA }],
      isPinned,
      initial
    )

    expect(updated.items[0]).not.toBe(initial.items[1])
    expect(updated.items[0].pinned).toBe(true)
    expect(updated.items[1]).toBe(initial.items[0])
  })
})
