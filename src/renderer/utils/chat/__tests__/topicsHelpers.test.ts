import type { Topic } from '@renderer/types/topic'
import type {
  ResourceListGroupReorderPayload,
  ResourceListItemReorderPayload
} from '@renderer/utils/chat/resourceListBase'
import { describe, expect, it } from 'vitest'

import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  groupTopicByPinned,
  moveAssistantGroupAfterDrop,
  moveTopicAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_ORDINARY_GROUP_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID
} from '../topicsHelpers'

const TOPIC_GROUP_LABELS = {
  pinned: 'Pinned',
  ordinary: 'Conversations',
  assistant: {
    unlinked: 'Unlinked Assistant'
  }
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    assistantId: 'assistant-1',
    name: 'Topic one',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    pinned: false,
    ...overrides
  }
}

describe('Topics helpers', () => {
  it('translates assistant visual drops into persisted order anchors', () => {
    const basePayload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'b',
      position: 'before',
      overType: 'item',
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-1',
      sourceIndex: 1,
      targetIndex: 0
    }

    expect(buildTopicDropAnchor(basePayload)).toEqual({ before: 'b' })
    expect(buildTopicDropAnchor({ ...basePayload, position: 'after' })).toEqual({ after: 'b' })
    expect(
      buildTopicDropAnchor({ ...basePayload, overId: 'topic:assistant:assistant-1', overType: 'group' })
    ).toBeUndefined()
  })

  it('translates assistant group drops into persisted order anchors', () => {
    const basePayload: ResourceListGroupReorderPayload = {
      type: 'group',
      activeGroupId: 'topic:assistant:assistant-a',
      overGroupId: 'topic:assistant:assistant-b',
      overType: 'group',
      sourceIndex: 1,
      targetIndex: 2
    }

    expect(buildAssistantGroupDropAnchor(basePayload, 'assistant-b')).toEqual({ after: 'assistant-b' })
    expect(buildAssistantGroupDropAnchor({ ...basePayload, sourceIndex: 2, targetIndex: 1 }, 'assistant-b')).toEqual({
      before: 'assistant-b'
    })
  })

  it('projects assistant group drops into optimistic assistant order', () => {
    expect(
      moveAssistantGroupAfterDrop(['assistant-a', 'assistant-b', 'assistant-c'], 'assistant-a', 'assistant-c', {
        sourceIndex: 0,
        targetIndex: 2
      })
    ).toEqual(['assistant-b', 'assistant-c', 'assistant-a'])
    expect(
      moveAssistantGroupAfterDrop(['assistant-a', 'assistant-b', 'assistant-c'], 'assistant-c', 'assistant-a', {
        sourceIndex: 2,
        targetIndex: 0
      })
    ).toEqual(['assistant-c', 'assistant-a', 'assistant-b'])
  })

  it('preserves same-group item drop positions from the insertion line', () => {
    const basePayload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'b',
      position: 'before',
      overType: 'item',
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-1',
      sourceIndex: 0,
      targetIndex: 1
    }

    expect(normalizeTopicDropPayload(basePayload)).toBe(basePayload)

    const movingUpPayload = {
      ...basePayload,
      position: 'after' as const,
      sourceIndex: 1,
      targetIndex: 0
    }
    expect(normalizeTopicDropPayload(movingUpPayload)).toBe(movingUpPayload)

    const crossGroupPayload = {
      ...basePayload,
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-2'
    }
    expect(normalizeTopicDropPayload(crossGroupPayload)).toBe(crossGroupPayload)
  })

  it('projects ResourceList drag payload into the dropped topic order', () => {
    const topics = [createTopic({ id: 'a' }), createTopic({ id: 'b' }), createTopic({ id: 'c' })]
    const payload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'c',
      position: 'after',
      overType: 'item',
      sourceGroupId: 'all',
      targetGroupId: 'all',
      sourceIndex: 0,
      targetIndex: 2
    }

    expect(moveTopicAfterDrop(topics, payload).map((topic) => topic.id)).toEqual(['b', 'c', 'a'])
    expect(topics.map((topic) => topic.id)).toEqual(['a', 'b', 'c'])
  })

  it('projects group drops at the visual append position of the target group', () => {
    const topics = [
      createTopic({ id: 'a', assistantId: 'assistant-1' }),
      createTopic({ id: 'b', assistantId: 'assistant-2' }),
      createTopic({ id: 'c', assistantId: 'assistant-2' }),
      createTopic({ id: 'd', assistantId: 'assistant-3' })
    ]
    const groupBy = (topic: Topic) => ({
      id: `topic:assistant:${topic.assistantId}`,
      label: topic.assistantId ?? 'default'
    })
    const payload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'topic:assistant:assistant-2',
      position: 'before',
      overType: 'group',
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-2',
      sourceIndex: 0,
      targetIndex: 0
    }

    expect(applyOptimisticTopicDisplayMove(topics, payload, 'assistant-2', groupBy).map((topic) => topic.id)).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
  })

  it('groups pinned topics separately for ResourceList rendering', () => {
    expect(groupTopicByPinned(createTopic({ pinned: true }), 'Pinned', 'Topics')).toEqual({
      id: 'pinned',
      label: 'Pinned'
    })
    expect(groupTopicByPinned(createTopic({ pinned: false }), 'Pinned', 'Topics')).toEqual({
      id: 'topics',
      label: 'Topics'
    })
  })

  it('builds pinned and ordinary creation-time groups', () => {
    const groupTopic = createTopicDisplayGroupResolver({ mode: 'time', labels: TOPIC_GROUP_LABELS })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'regular' }))).toEqual({
      id: TOPIC_ORDINARY_GROUP_ID,
      label: 'Conversations'
    })
  })

  it('keeps pinned topics stable and sorts the flat stream by createdAt descending', () => {
    const topics = [
      createTopic({ id: 'created-old', createdAt: localIso(2026, 5, 1), updatedAt: localIso(2026, 5, 20) }),
      createTopic({ id: 'pinned-old', pinned: true, createdAt: localIso(2026, 4, 1) }),
      createTopic({ id: 'created-new', createdAt: localIso(2026, 5, 10), updatedAt: localIso(2026, 4, 1) }),
      createTopic({ id: 'pinned-new', pinned: true, createdAt: localIso(2026, 5, 20) })
    ]

    expect(sortTopicsForDisplayGroups(topics, { mode: 'time', sortBy: 'createdAt' }).map((topic) => topic.id)).toEqual([
      'pinned-old',
      'pinned-new',
      'created-new',
      'created-old'
    ])
  })

  it('builds assistant display groups with pinned/known/unlinked buckets', () => {
    const groupTopic = createTopicDisplayGroupResolver({
      assistantById: new Map([
        ['assistant-1', { id: 'assistant-1', name: 'Research' }],
        ['assistant-2', { id: 'assistant-2', name: 'Writing' }]
      ]),
      defaultAssistant: { name: 'Default Assistant' },
      labels: TOPIC_GROUP_LABELS,
      mode: 'assistant'
    })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, assistantId: undefined }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'default', assistantId: undefined }))).toEqual({
      id: TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
      label: 'Default Assistant'
    })
    expect(groupTopic(createTopic({ id: 'known', assistantId: 'assistant-2' }))).toEqual({
      id: 'topic:assistant:assistant-2',
      label: 'Writing'
    })
    expect(groupTopic(createTopic({ id: 'unknown', assistantId: 'missing-assistant' }))).toEqual({
      id: TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
      label: 'Unlinked Assistant'
    })
  })

  it('sorts assistant display groups by pinned, assistant rank, then unknown while preserving group order', () => {
    const topics = [
      createTopic({ id: 'assistant-b-1', assistantId: 'assistant-b' }),
      createTopic({ id: 'unknown-1', assistantId: 'missing-assistant' }),
      createTopic({ id: 'default-1', assistantId: undefined }),
      createTopic({ id: 'assistant-a-1', assistantId: 'assistant-a' }),
      createTopic({ id: 'pinned-1', assistantId: 'missing-assistant', pinned: true }),
      createTopic({ id: 'assistant-b-2', assistantId: 'assistant-b' })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, {
        assistantRankById: new Map([
          ['assistant-a', 0],
          ['assistant-b', 1]
        ]),
        mode: 'assistant',
        sortBy: 'orderKey'
      }).map((topic) => topic.id)
    ).toEqual(['pinned-1', 'assistant-a-1', 'assistant-b-1', 'assistant-b-2', 'default-1', 'unknown-1'])
  })

  it('sorts assistant group topics by raw persisted orderKey ascending when available', () => {
    const topics = [
      createTopic({ id: 'first-created', assistantId: 'assistant-a', orderKey: 'a0' }),
      createTopic({ id: 'inserted-before-first', assistantId: 'assistant-a', orderKey: 'Zz' }),
      createTopic({ id: 'inserted-before-that', assistantId: 'assistant-a', orderKey: 'Zy' })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, {
        assistantRankById: new Map([['assistant-a', 0]]),
        mode: 'assistant',
        sortBy: 'orderKey'
      }).map((topic) => topic.id)
    ).toEqual(['inserted-before-that', 'inserted-before-first', 'first-created'])
  })

  it('uses the selected timestamp within each assistant without changing assistant rank', () => {
    const topics = [
      createTopic({ id: 'assistant-b-new', assistantId: 'assistant-b', lastActivityAt: localIso(2026, 5, 20) }),
      createTopic({ id: 'assistant-a-old', assistantId: 'assistant-a', lastActivityAt: localIso(2026, 5, 1) }),
      createTopic({ id: 'assistant-b-old', assistantId: 'assistant-b', lastActivityAt: localIso(2026, 5, 2) }),
      createTopic({ id: 'assistant-a-new', assistantId: 'assistant-a', lastActivityAt: localIso(2026, 5, 21) })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, {
        assistantRankById: new Map([
          ['assistant-a', 0],
          ['assistant-b', 1]
        ]),
        mode: 'assistant',
        sortBy: 'lastActivityAt'
      }).map((topic) => topic.id)
    ).toEqual(['assistant-a-new', 'assistant-a-old', 'assistant-b-new', 'assistant-b-old'])
  })
})
