import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'

export type ConversationIslandSurface =
  | { kind: 'compact'; primary: ConversationIslandActivityItem; totalCount: number }
  | { kind: 'single-detail'; activity: ConversationIslandActivityItem }
  | { kind: 'activity-list'; activities: ConversationIslandActivityItem[]; primaryActivityId: string }

export function resolveConversationIslandSurface(snapshot: ConversationIslandSnapshot): ConversationIslandSurface {
  if (!snapshot.expanded) {
    return { kind: 'compact', primary: snapshot, totalCount: snapshot.secondaryCount + 1 }
  }

  if (snapshot.secondaryCount === 0) {
    return { kind: 'single-detail', activity: snapshot }
  }

  return {
    kind: 'activity-list',
    activities: snapshot.activities!,
    primaryActivityId: snapshot.activityId
  }
}
