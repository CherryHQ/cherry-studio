import type { ResourceListItemReorderPayload } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  buildTopicDropAnchor,
  createTopicDisplayGroupResolver,
  filterTopicsForManageMode,
  getTopicTimeBucket,
  groupTopicByPinned,
  moveTopicAfterDrop,
  normalizeTopicDropPayload,
  sortTopicsForDisplayGroups,
  TOPIC_DEFAULT_ASSISTANT_GROUP_ID,
  TOPIC_UNKNOWN_ASSISTANT_GROUP_ID
} from '../Topics.helpers'

const TOPIC_GROUP_LABELS = {
  pinned: 'Pinned',
  time: {
    today: 'Today',
    yesterday: 'Yesterday',
    'this-week': 'This week',
    earlier: 'Earlier'
  },
  assistant: {
    default: 'Default Assistant',
    unknown: 'Unknown Assistant'
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
  it('translates descending assistant visual drops into persisted order anchors', () => {
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

    expect(buildTopicDropAnchor(basePayload)).toEqual({ after: 'b' })
    expect(buildTopicDropAnchor({ ...basePayload, position: 'after' })).toEqual({ before: 'b' })
    expect(buildTopicDropAnchor({ ...basePayload, overId: 'topic:assistant:assistant-1', overType: 'group' })).toEqual({
      position: 'last'
    })
  })

  it('normalizes same-group item drops by source and target indexes', () => {
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

    expect(normalizeTopicDropPayload(basePayload)).toEqual({ ...basePayload, position: 'after' })
    expect(
      normalizeTopicDropPayload({
        ...basePayload,
        position: 'after',
        sourceIndex: 1,
        targetIndex: 0
      })
    ).toEqual({
      ...basePayload,
      position: 'before',
      sourceIndex: 1,
      targetIndex: 0
    })

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

  it('filters manage-mode topics by all space-separated keywords only while managing', () => {
    const topics = [
      createTopic({ id: 'a', name: 'Daily planning topic' }),
      createTopic({ id: 'b', name: 'Daily research notes' }),
      createTopic({ id: 'c', name: 'Release planning' })
    ]

    expect(filterTopicsForManageMode(topics, 'daily topic', true).map((topic) => topic.id)).toEqual(['a'])
    expect(filterTopicsForManageMode(topics, 'daily topic', false).map((topic) => topic.id)).toEqual(['a', 'b', 'c'])
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

  it('classifies topic updatedAt values into reusable time buckets', () => {
    const now = new Date(2026, 4, 15, 12)

    expect(getTopicTimeBucket(localIso(2026, 5, 15, 9), now)).toBe('today')
    expect(getTopicTimeBucket(localIso(2026, 5, 14, 9), now)).toBe('yesterday')
    expect(getTopicTimeBucket(localIso(2026, 5, 13, 9), now)).toBe('this-week')
    expect(getTopicTimeBucket(localIso(2026, 5, 8, 23), now)).toBe('earlier')
  })

  it('builds time display groups with pinned topics taking precedence', () => {
    const now = new Date(2026, 4, 15, 12)
    const groupTopic = createTopicDisplayGroupResolver({ mode: 'time', labels: TOPIC_GROUP_LABELS, now })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, updatedAt: localIso(2026, 5, 15, 9) }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'today', updatedAt: localIso(2026, 5, 15, 9) }))).toEqual({
      id: 'topic:time:today',
      label: 'Today'
    })
    expect(groupTopic(createTopic({ id: 'yesterday', updatedAt: localIso(2026, 5, 14, 9) }))).toEqual({
      id: 'topic:time:yesterday',
      label: 'Yesterday'
    })
    expect(groupTopic(createTopic({ id: 'week', updatedAt: localIso(2026, 5, 13, 9) }))).toEqual({
      id: 'topic:time:this-week',
      label: 'This week'
    })
    expect(groupTopic(createTopic({ id: 'earlier', updatedAt: localIso(2026, 5, 8, 23) }))).toEqual({
      id: 'topic:time:earlier',
      label: 'Earlier'
    })
  })

  it('keeps the pinned topic layer above time-derived groups with stable order inside each layer', () => {
    const now = new Date(2026, 4, 15, 12)
    const topics = [
      createTopic({ id: 'week', updatedAt: localIso(2026, 5, 13, 9) }),
      createTopic({ id: 'pinned-old', pinned: true, updatedAt: localIso(2026, 5, 8, 23) }),
      createTopic({ id: 'today', updatedAt: localIso(2026, 5, 15, 9) }),
      createTopic({ id: 'pinned-new', pinned: true, updatedAt: localIso(2026, 5, 15, 9) })
    ]

    expect(sortTopicsForDisplayGroups(topics, { mode: 'time', now }).map((topic) => topic.id)).toEqual([
      'pinned-old',
      'pinned-new',
      'today',
      'week'
    ])
  })

  it('builds assistant display groups with pinned/default/known/unknown buckets', () => {
    const groupTopic = createTopicDisplayGroupResolver({
      assistantById: new Map([
        ['assistant-1', { id: 'assistant-1', name: 'Research' }],
        ['assistant-2', { id: 'assistant-2', name: 'Writing' }]
      ]),
      labels: TOPIC_GROUP_LABELS,
      mode: 'assistant'
    })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, assistantId: undefined }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'default', assistantId: undefined }))).toEqual({
      id: TOPIC_DEFAULT_ASSISTANT_GROUP_ID,
      label: 'Default Assistant'
    })
    expect(groupTopic(createTopic({ id: 'known', assistantId: 'assistant-2' }))).toEqual({
      id: 'topic:assistant:assistant-2',
      label: 'Writing'
    })
    expect(groupTopic(createTopic({ id: 'unknown', assistantId: 'missing-assistant' }))).toEqual({
      id: TOPIC_UNKNOWN_ASSISTANT_GROUP_ID,
      label: 'Unknown Assistant'
    })
  })

  it('sorts assistant display groups by pinned, default, assistant rank, then unknown while preserving group order', () => {
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
        mode: 'assistant'
      }).map((topic) => topic.id)
    ).toEqual(['pinned-1', 'default-1', 'assistant-a-1', 'assistant-b-1', 'assistant-b-2', 'unknown-1'])
  })

  it('sorts assistant group topics by persisted orderKey descending when available', () => {
    const topics = [
      createTopic({ id: 'assistant-a-3', assistantId: 'assistant-a', orderKey: 'c' }),
      createTopic({ id: 'assistant-a-1', assistantId: 'assistant-a', orderKey: 'a' }),
      createTopic({ id: 'assistant-a-2', assistantId: 'assistant-a', orderKey: 'b' })
    ]

    expect(
      sortTopicsForDisplayGroups(topics, {
        assistantRankById: new Map([['assistant-a', 0]]),
        mode: 'assistant'
      }).map((topic) => topic.id)
    ).toEqual(['assistant-a-3', 'assistant-a-2', 'assistant-a-1'])
  })
})
