import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { describe, expect, it } from 'vitest'

import { resolveConversationIslandSurface } from '../conversationIslandSurface'

const activity = (activityId: string, title: string): ConversationIslandActivityItem => ({
  activityId,
  identityAvatar: '🌸',
  identityName: 'Cherry Assistant',
  target: { conversationType: 'assistant', conversationId: activityId },
  state: 'streaming',
  statusText: 'Responding',
  title
})

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activity('topic-1', 'New Chat'),
  activityCountText: 'Total: 1',
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  exiting: false,
  reducedMotion: false,
  ...overrides
})

describe('resolveConversationIslandSurface', () => {
  it.each([0, 2])('provides the compact payload while collapsed with %i secondary activities', (secondaryCount) => {
    const compactSnapshot = snapshot({ secondaryCount })
    const surface = resolveConversationIslandSurface(compactSnapshot)

    expect(surface.kind).toBe('compact')
    if (surface.kind !== 'compact') throw new Error('Expected compact surface')
    expect(surface.primary).toBe(compactSnapshot)
    expect(surface.totalCount).toBe(secondaryCount + 1)
  })

  it('provides the snapshot as the single detailed activity', () => {
    const singleSnapshot = snapshot({ expanded: true })
    const surface = resolveConversationIslandSurface(singleSnapshot)

    expect(surface.kind).toBe('single-detail')
    if (surface.kind !== 'single-detail') throw new Error('Expected single-detail surface')
    expect(surface.activity).toBe(singleSnapshot)
  })

  it('provides the authoritative activity list and primary activity id', () => {
    const activities = [activity('topic-1', 'New Chat'), activity('topic-2', 'Review plan')]
    const surface = resolveConversationIslandSurface(snapshot({ expanded: true, secondaryCount: 1, activities }))

    expect(surface.kind).toBe('activity-list')
    if (surface.kind !== 'activity-list') throw new Error('Expected activity-list surface')
    expect(surface.activities).toBe(activities)
    expect(surface.primaryActivityId).toBe('topic-1')
  })

  it.each([{ presentation: 'notch' as const, notchWidth: 180 }, { exiting: true }, { reducedMotion: true }])(
    'does not use presentation or transient state to choose the surface kind',
    (overrides) => {
      const activities = [activity('topic-1', 'New Chat'), activity('topic-2', 'Review plan')]

      expect(
        resolveConversationIslandSurface(snapshot({ expanded: true, secondaryCount: 1, activities, ...overrides })).kind
      ).toBe('activity-list')
    }
  )
})
