import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { describe, expect, it } from 'vitest'

import { resolveConversationIslandSurface } from '../conversationIslandSurface'

const activity = (activityId: string): ConversationIslandActivityItem => ({
  activityId,
  identityAvatar: '🌸',
  identityName: 'Cherry Assistant',
  target: { conversationType: 'assistant', conversationId: activityId },
  state: 'streaming',
  statusText: 'Responding',
  title: `Conversation ${activityId}`
})

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activity('primary'),
  activityCountText: 'Total: 1',
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  exiting: false,
  reducedMotion: false,
  ...overrides
})

describe('resolveConversationIslandSurface', () => {
  it('uses the primary activity and total count for compact snapshots', () => {
    const input = snapshot({ secondaryCount: 2 })

    const surface = resolveConversationIslandSurface(input)

    expect(surface).toEqual({ kind: 'compact', primary: input, totalCount: 3 })
  })

  it('uses the snapshot itself for an expanded single activity', () => {
    const input = snapshot({ expanded: true })

    const surface = resolveConversationIslandSurface(input)

    expect(surface).toEqual({ kind: 'single-detail', activity: input })
  })

  it('preserves activity order and primary identity for an expanded activity list', () => {
    const activities = [activity('primary'), activity('secondary')]

    const surface = resolveConversationIslandSurface(
      snapshot({ expanded: true, secondaryCount: 1, activities, activityCountText: 'Total: 2' })
    )

    expect(surface).toEqual({ kind: 'activity-list', activities, primaryActivityId: 'primary' })
  })
})
