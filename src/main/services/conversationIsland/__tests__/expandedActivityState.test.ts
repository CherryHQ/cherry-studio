import type { TopicStreamStatus } from '@shared/ai/transport'
import { describe, expect, it } from 'vitest'

import {
  type ConversationActivityUpdate,
  type ConversationIslandActivity,
  reduceActivities,
  TERMINAL_TTL_MS
} from '../activityReducer'
import {
  createExpandedActivityState,
  reconcileExpandedActivityState,
  resolveExpandedActivities
} from '../expandedActivityState'

function update(topicId: string, status: TopicStreamStatus, changedAt: number): ConversationActivityUpdate {
  return {
    topicId,
    turnId: `${topicId}-turn`,
    target: { conversationType: 'assistant', conversationId: topicId },
    status,
    changedAt,
    originDisplayId: 1
  }
}

function add(
  activities: Map<string, ConversationIslandActivity>,
  topicId: string,
  status: TopicStreamStatus,
  changedAt: number
): void {
  reduceActivities(activities, update(topicId, status, changedAt))
}

describe('expandedActivityState', () => {
  it('creates an initial state in deterministic order and requires at least two activities', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-live', 'streaming', 300)

    expect(createExpandedActivityState(activities, 301, 7)).toBeNull()

    add(activities, 'topic-done', 'done', 200)
    add(activities, 'topic-approval', 'awaiting-approval', 100)

    expect(createExpandedActivityState(activities, 301, 7)).toEqual({
      displayId: 7,
      primaryActivityId: 'topic-approval',
      activityIds: ['topic-approval', 'topic-done', 'topic-live']
    })
  })

  it('keeps frozen activities in place after status changes and appends new activities in current order', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-approval', 'awaiting-approval', 100)
    add(activities, 'topic-live', 'streaming', 90)
    const initial = createExpandedActivityState(activities, 101, 7)
    expect(initial).not.toBeNull()

    add(activities, 'topic-live', 'awaiting-approval', 300)
    add(activities, 'topic-live-new', 'streaming', 500)
    add(activities, 'topic-error-new', 'error', 400)

    expect(reconcileExpandedActivityState(initial!, activities, 501)).toEqual({
      displayId: 7,
      primaryActivityId: 'topic-approval',
      activityIds: ['topic-approval', 'topic-live', 'topic-error-new', 'topic-live-new']
    })
  })

  it('retains an expired terminal activity while it remains frozen', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-done', 'done', 100)
    add(activities, 'topic-live', 'streaming', 200)
    const initial = createExpandedActivityState(activities, 201, 7)
    expect(initial).not.toBeNull()

    expect(reconcileExpandedActivityState(initial!, activities, 100 + TERMINAL_TTL_MS.done)).toEqual(initial)
    expect(activities.has('topic-done')).toBe(true)
  })

  it('removes a deleted primary and reassigns it without reordering the remaining activities', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-approval', 'awaiting-approval', 100)
    add(activities, 'topic-done', 'done', 90)
    add(activities, 'topic-live', 'streaming', 80)
    const initial = createExpandedActivityState(activities, 101, 7)
    expect(initial).not.toBeNull()

    activities.delete('topic-approval')

    expect(reconcileExpandedActivityState(initial!, activities, 102)).toEqual({
      displayId: 7,
      primaryActivityId: 'topic-done',
      activityIds: ['topic-done', 'topic-live']
    })
  })

  it('returns null when an aborted activity leaves fewer than two activities', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-approval', 'awaiting-approval', 100)
    add(activities, 'topic-live', 'streaming', 90)
    const initial = createExpandedActivityState(activities, 101, 7)
    expect(initial).not.toBeNull()

    reduceActivities(activities, update('topic-live', 'aborted', 102))

    expect(reconcileExpandedActivityState(initial!, activities, 102)).toBeNull()
  })

  it('resolves the existing activity objects in frozen order', () => {
    const activities = new Map<string, ConversationIslandActivity>()
    add(activities, 'topic-done', 'done', 100)
    add(activities, 'topic-live', 'streaming', 200)
    const done = activities.get('topic-done')!
    const live = activities.get('topic-live')!

    expect(
      resolveExpandedActivities(
        {
          displayId: 7,
          primaryActivityId: 'topic-live',
          activityIds: ['topic-live', 'topic-missing', 'topic-done']
        },
        activities
      )
    ).toEqual([live, done])
  })
})
