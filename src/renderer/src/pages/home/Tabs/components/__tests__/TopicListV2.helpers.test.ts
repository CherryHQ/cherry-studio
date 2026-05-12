import type { ResourceListReorderPayload } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  buildTopicOrderMoves,
  createTopicDisplayGroupResolver,
  filterTopicsForManageMode,
  getTopicTimeBucket,
  groupTopicByPinned,
  moveTopicAfterDrop,
  sortTopicsForDisplayGroups
} from '../TopicListV2.helpers'

const TOPIC_GROUP_LABELS = {
  pinned: 'Pinned',
  time: {
    today: 'Today',
    'within-week': 'Within a week',
    earlier: 'Earlier'
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

describe('TopicListV2 helpers', () => {
  it('builds minimal order moves using fractional anchors', () => {
    expect(buildTopicOrderMoves(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual([
      { id: 'b', anchor: { position: 'first' } },
      { id: 'a', anchor: { after: 'b' } }
    ])

    expect(buildTopicOrderMoves(['a', 'b', 'c'], ['a', 'c', 'b'])).toEqual([
      { id: 'c', anchor: { after: 'a' } },
      { id: 'b', anchor: { after: 'c' } }
    ])
  })

  it('projects ResourceList drag payload into the dropped topic order', () => {
    const topics = [createTopic({ id: 'a' }), createTopic({ id: 'b' }), createTopic({ id: 'c' })]
    const payload: ResourceListReorderPayload = { activeId: 'a', overId: 'c', position: 'after' }

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
    const now = new Date(2026, 4, 12, 12)

    expect(getTopicTimeBucket(localIso(2026, 5, 12, 9), now)).toBe('today')
    expect(getTopicTimeBucket(localIso(2026, 5, 6, 9), now)).toBe('within-week')
    expect(getTopicTimeBucket(localIso(2026, 5, 4, 23), now)).toBe('earlier')
  })

  it('builds time display groups with pinned topics taking precedence', () => {
    const now = new Date(2026, 4, 12, 12)
    const groupTopic = createTopicDisplayGroupResolver({ mode: 'time', labels: TOPIC_GROUP_LABELS, now })

    expect(groupTopic(createTopic({ id: 'pinned', pinned: true, updatedAt: localIso(2026, 5, 12, 9) }))).toEqual({
      id: 'topic:pinned',
      label: 'Pinned'
    })
    expect(groupTopic(createTopic({ id: 'today', updatedAt: localIso(2026, 5, 12, 9) }))).toEqual({
      id: 'topic:time:today',
      label: 'Today'
    })
    expect(groupTopic(createTopic({ id: 'week', updatedAt: localIso(2026, 5, 6, 9) }))).toEqual({
      id: 'topic:time:within-week',
      label: 'Within a week'
    })
    expect(groupTopic(createTopic({ id: 'earlier', updatedAt: localIso(2026, 5, 4, 23) }))).toEqual({
      id: 'topic:time:earlier',
      label: 'Earlier'
    })
  })

  it('keeps the pinned topic layer above time-derived groups with stable order inside each layer', () => {
    const topics = [
      createTopic({ id: 'today', updatedAt: localIso(2026, 5, 12, 9) }),
      createTopic({ id: 'pinned-old', pinned: true, updatedAt: localIso(2026, 5, 4, 23) }),
      createTopic({ id: 'week', updatedAt: localIso(2026, 5, 6, 9) }),
      createTopic({ id: 'pinned-new', pinned: true, updatedAt: localIso(2026, 5, 12, 9) })
    ]

    expect(sortTopicsForDisplayGroups(topics).map((topic) => topic.id)).toEqual([
      'pinned-old',
      'pinned-new',
      'today',
      'week'
    ])
  })
})
