import type { ResourceListReorderPayload } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  buildTopicOrderMoves,
  filterTopicsForManageMode,
  groupTopicByPinned,
  moveTopicAfterDrop
} from '../TopicListV2.helpers'

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
})
