import { describe, expect, it } from 'vitest'

import type { Topic } from '@renderer/types/topic'

import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  getTopicTimeBucket,
  groupTopicByPinned,
  moveAssistantGroupAfterDrop,
  moveTopicAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID
} from '../topicsHelpers'
import { createResourceListGroupReorderPayload, createResourceListItemReorderPayload } from './resourceListFixtures'

const TOPIC_GROUP_LABELS = {
  pinned: 'Pinned',
  time: {
    today: 'Today',
    yesterday: 'Yesterday',
    'this-week': 'This week',
    earlier: 'Earlier'
  },
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
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    pinned: false,
    ...overrides
  }
}

describe('Topics helpers', () => {
  it('translates assistant visual drops into persisted order anchors', () => {
    const basePayload = createResourceListItemReorderPayload({
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-1',
      sourceIndex: 1,
      targetIndex: 0
    })

    expect(buildTopicDropAnchor(basePayload)).toEqual({ before: 'b' })
    expect(buildTopicDropAnchor({ ...basePayload, position: 'after' })).toEqual({ after: 'b' })
    expect(buildTopicDropAnchor({ ...basePayload, overId: 'topic:assistant:assistant-1', overType: 'group' })).toEqual({
      position: 'last'
    })
  })

  it('translates assistant group drops into persisted order anchors', () => {
    const basePayload = createResourceListGroupReorderPayload({
      activeGroupId: 'topic:assistant:assistant-a',
      overGroupId: 'topic:assistant:assistant-b',
      sourceIndex: 1,
      targetIndex: 2
    })

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
    const basePayload = createResourceListItemReorderPayload({
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-1'
    })

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
    const payload = createResourceListItemReorderPayload({
      overId: 'c',
      position: 'after',
      sourceGroupId: 'all',
      targetGroupId: 'all',
      targetIndex: 2
    })

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
    const payload = createResourceListItemReorderPayload({
      overId: 'topic:assistant:assistant-2',
      overType: 'group',
      sourceGroupId: 'topic:assistant:assistant-1',
      targetGroupId: 'topic:assistant:assistant-2',
      targetIndex: 0
    })

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

  it('classifies topic lastActivityAt values into reusable time buckets', () => {
    const now = new Date(2026, 4, 15, 12)

    expect(getTopicTimeBucket(localIso(2026, 5, 15, 9), now)).toBe('today')
    expect(getTopicTimeBucket(localIso(2026, 5, 14, 9), now)).toBe('yesterday')
    expect(getTopicTimeBucket(localIso(2026, 5, 13, 9), now)).toBe('this-week')
    expect(getTopicTimeBucket(localIso(2026, 5, 8, 23), now)).toBe('earlier')
  })

  it('builds time display groups with pinned topics taking precedence', () => {
    const now = new Date(2026, 4, 15, 12)
    const groupTopic = createTopicDisplayGroupResolver({ mode: 'time', labels: TOPIC_GROUP_LABELS, now })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, lastActivityAt: localIso(2026, 5, 15, 9) }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'today', lastActivityAt: localIso(2026, 5, 15, 9) }))).toEqual({
      id: 'topic:time:today',
      label: 'Today'
    })
    expect(groupTopic(createTopic({ id: 'yesterday', lastActivityAt: localIso(2026, 5, 14, 9) }))).toEqual({
      id: 'topic:time:yesterday',
      label: 'Yesterday'
    })
    expect(groupTopic(createTopic({ id: 'week', lastActivityAt: localIso(2026, 5, 13, 9) }))).toEqual({
      id: 'topic:time:this-week',
      label: 'This week'
    })
    expect(groupTopic(createTopic({ id: 'earlier', lastActivityAt: localIso(2026, 5, 8, 23) }))).toEqual({
      id: 'topic:time:earlier',
      label: 'Earlier'
    })
  })

  it('keeps pinned topics stable and sorts time buckets by lastActivityAt descending', () => {
    const now = new Date(2026, 4, 15, 12)
    const topics = [
      createTopic({ id: 'today-old', lastActivityAt: localIso(2026, 5, 15, 8) }),
      createTopic({ id: 'week', lastActivityAt: localIso(2026, 5, 13, 9) }),
      createTopic({ id: 'pinned-old', pinned: true, lastActivityAt: localIso(2026, 5, 8, 23) }),
      createTopic({ id: 'today-new', lastActivityAt: localIso(2026, 5, 15, 9) }),
      createTopic({ id: 'pinned-new', pinned: true, lastActivityAt: localIso(2026, 5, 15, 9) })
    ]

    expect(sortTopicsForDisplayGroups(topics, { mode: 'time', now }).map((topic) => topic.id)).toEqual([
      'pinned-old',
      'pinned-new',
      'today-new',
      'today-old',
      'week'
    ])
  })

  it('keeps pinned topics inside their assistant display group', () => {
    const groupTopic = createTopicDisplayGroupResolver({
      assistantById: new Map([
        ['assistant-1', { id: 'assistant-1', name: 'Research' }],
        ['assistant-2', { id: 'assistant-2', name: 'Writing' }]
      ]),
      labels: TOPIC_GROUP_LABELS,
      mode: 'assistant'
    })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, assistantId: 'assistant-1' }))).toEqual({
      id: 'topic:assistant:assistant-1',
      label: 'Research'
    })
    expect(groupTopic(createTopic({ id: 'unlinked', assistantId: undefined }))).toEqual({
      id: TOPIC_UNLINKED_ASSISTANT_GROUP_ID,
      label: 'Unlinked Assistant'
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

  it('sorts assistant groups by rank with pinned topics first inside each assistant', () => {
    const topics = [
      createTopic({ id: 'assistant-b-1', assistantId: 'assistant-b' }),
      createTopic({ id: 'unknown-1', assistantId: 'missing-assistant' }),
      createTopic({ id: 'default-1', assistantId: undefined }),
      createTopic({ id: 'assistant-a-1', assistantId: 'assistant-a' }),
      createTopic({ id: 'pinned-a', assistantId: 'assistant-a', pinned: true }),
      createTopic({ id: 'pinned-b', assistantId: 'assistant-b', pinned: true }),
      createTopic({ id: 'pinned-unknown', assistantId: 'missing-assistant', pinned: true }),
      createTopic({ id: 'assistant-b-2', assistantId: 'assistant-b' })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, {
        assistantRankById: new Map([
          ['assistant-a', 0],
          ['assistant-b', 1]
        ]),
        mode: 'assistant'
      }).map((topic) => topic.id)
    ).toEqual([
      'pinned-a',
      'assistant-a-1',
      'pinned-b',
      'assistant-b-1',
      'assistant-b-2',
      'pinned-unknown',
      'unknown-1',
      'default-1'
    ])
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
        mode: 'assistant'
      }).map((topic) => topic.id)
    ).toEqual(['inserted-before-that', 'inserted-before-first', 'first-created'])
  })
})
