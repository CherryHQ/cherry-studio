import type { TopicStreamStatus } from '@shared/ai/transport'
import { describe, expect, it } from 'vitest'

import {
  type ConversationActivityUpdate,
  type ConversationIslandActivity,
  reduceActivities,
  selectEligibleActivities,
  selectPrimaryActivity,
  TERMINAL_TTL_MS
} from '../activityReducer'

function update(
  topicId: string,
  status: TopicStreamStatus | null,
  changedAt: number,
  originDisplayId = 1,
  turnId = `${topicId}-turn`
): ConversationActivityUpdate {
  return {
    topicId,
    turnId,
    target: { conversationType: topicId.startsWith('agent-') ? 'agent' : 'assistant', conversationId: topicId },
    status,
    changedAt,
    originDisplayId
  }
}

function state(): Map<string, ConversationIslandActivity> {
  return new Map()
}

describe('activityReducer', () => {
  it('selects awaiting confirmation ahead of newer terminal and live activity', () => {
    const activities = state()
    reduceActivities(activities, update('topic-live', 'streaming', 100))
    reduceActivities(activities, update('topic-done', 'done', 200))
    reduceActivities(activities, update('topic-approval', 'awaiting-approval', 150))

    expect(selectPrimaryActivity(activities, 201)).toMatchObject({
      primary: { topicId: 'topic-approval' },
      secondaryCount: 2
    })
  })

  it('selects terminal activity ahead of live activity and uses changedAt within a priority class', () => {
    const activities = state()
    reduceActivities(activities, update('topic-live', 'streaming', 300))
    reduceActivities(activities, update('topic-done-old', 'done', 100))
    reduceActivities(activities, update('topic-error-new', 'error', 200))

    expect(selectPrimaryActivity(activities, 301).primary?.topicId).toBe('topic-error-new')
  })

  it('orders eligible activities by priority, recency, and topic id', () => {
    const activities = state()
    reduceActivities(activities, update('topic-live-new', 'streaming', 500))
    reduceActivities(activities, update('topic-error', 'error', 100))
    reduceActivities(activities, update('topic-approval-old', 'awaiting-approval', 200))
    reduceActivities(activities, update('topic-approval-z', 'awaiting-approval', 300))
    reduceActivities(activities, update('topic-approval-a', 'awaiting-approval', 300))

    expect(selectEligibleActivities(activities, 501).map((activity) => activity.topicId)).toEqual([
      'topic-approval-a',
      'topic-approval-z',
      'topic-approval-old',
      'topic-error',
      'topic-live-new'
    ])
  })

  it('retains an expired terminal activity only while requested', () => {
    const activities = state()
    reduceActivities(activities, update('topic-done', 'done', 100))
    reduceActivities(activities, update('topic-live', 'streaming', 200))
    const now = 100 + TERMINAL_TTL_MS.done

    expect(
      selectEligibleActivities(activities, now, new Set(['topic-done'])).map((activity) => activity.topicId)
    ).toEqual(['topic-done', 'topic-live'])
    expect(activities.has('topic-done')).toBe(true)

    expect(selectEligibleActivities(activities, now).map((activity) => activity.topicId)).toEqual(['topic-live'])
    expect(activities.has('topic-done')).toBe(false)
  })

  it('expires done after four seconds and error after six seconds independently', () => {
    const activities = state()
    reduceActivities(activities, update('topic-done', 'done', 100))
    reduceActivities(activities, update('topic-error', 'error', 200))

    expect(activities.get('topic-done')?.expiresAt).toBe(100 + TERMINAL_TTL_MS.done)
    expect(activities.get('topic-error')?.expiresAt).toBe(200 + TERMINAL_TTL_MS.error)
    expect(selectPrimaryActivity(activities, 100 + TERMINAL_TTL_MS.done - 1).secondaryCount).toBe(1)

    const afterDoneExpiry = selectPrimaryActivity(activities, 100 + TERMINAL_TTL_MS.done)
    expect(afterDoneExpiry).toMatchObject({ primary: { topicId: 'topic-error' }, secondaryCount: 0 })
    expect(activities.has('topic-done')).toBe(false)

    expect(selectPrimaryActivity(activities, 200 + TERMINAL_TTL_MS.error).primary).toBeUndefined()
    expect(activities.size).toBe(0)
  })

  it.each([null, 'aborted'] as const)('removes activity immediately for %s', (status) => {
    const activities = state()
    reduceActivities(activities, update('topic-id', 'streaming', 100))

    reduceActivities(activities, update('topic-id', status, 200))

    expect(activities.size).toBe(0)
  })

  it('does not extend a terminal lifetime when the same state is observed again', () => {
    const activities = state()
    reduceActivities(activities, update('topic-id', 'done', 100))
    reduceActivities(activities, update('topic-id', 'done', 1_000))

    expect(activities.get('topic-id')).toMatchObject({ changedAt: 100, expiresAt: 100 + TERMINAL_TTL_MS.done })
  })

  it('retains the origin display through a turn and captures it again for a new pending turn', () => {
    const activities = state()
    reduceActivities(activities, update('topic-id', 'pending', 100, 7, 'turn-1'))
    reduceActivities(activities, update('topic-id', 'streaming', 200, 9, 'turn-1'))

    expect(activities.get('topic-id')?.originDisplayId).toBe(7)

    reduceActivities(activities, update('topic-id', 'pending', 300, 11, 'turn-2'))

    expect(activities.get('topic-id')).toMatchObject({ originDisplayId: 11, turnId: 'turn-2', changedAt: 300 })
  })
})
