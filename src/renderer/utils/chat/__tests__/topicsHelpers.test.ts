import { describe, expect, it } from 'vitest'

import type { Topic } from '@renderer/types/topic'

import {
  applyOptimisticTopicDisplayMove,
  buildAssistantGroupDropAnchor,
  buildTopicDropAnchor,
  getTopicTimeBucket,
  moveAssistantGroupAfterDrop,
  moveTopicAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups
} from '../topicsHelpers'
import { createResourceListGroupReorderPayload, createResourceListItemReorderPayload } from './resourceListFixtures'

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

  it('classifies topic lastActivityAt values into reusable time buckets', () => {
    const now = new Date(2026, 4, 15, 12)

    expect(getTopicTimeBucket(localIso(2026, 5, 15, 9), now)).toBe('today')
    expect(getTopicTimeBucket(localIso(2026, 5, 14, 9), now)).toBe('yesterday')
    expect(getTopicTimeBucket(localIso(2026, 5, 13, 9), now)).toBe('this-week')
    expect(getTopicTimeBucket(localIso(2026, 5, 8, 23), now)).toBe('earlier')
  })

  it('orders time-mode rows by orderKey inside each group when manualOrder is set', () => {
    const now = new Date(2026, 4, 15, 12)
    const topics = [
      createTopic({ id: 'today-b', lastActivityAt: localIso(2026, 5, 15, 9), orderKey: 'b' }),
      createTopic({ id: 'today-a', lastActivityAt: localIso(2026, 5, 15, 8), orderKey: 'a' }),
      createTopic({ id: 'week', lastActivityAt: localIso(2026, 5, 13, 9), orderKey: '0' }),
      createTopic({ id: 'pinned', pinned: true, lastActivityAt: localIso(2026, 5, 8, 23), orderKey: 'z' })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, { manualOrder: true, mode: 'time', now }).map((topic) => topic.id)
    ).toEqual(['pinned', 'today-a', 'today-b', 'week'])
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
