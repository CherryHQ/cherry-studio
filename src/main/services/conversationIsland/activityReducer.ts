import type { TopicStreamStatus } from '@shared/ai/transport'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

export const TERMINAL_TTL_MS = { done: 4_000, error: 6_000 } as const

type EligibleStatus = Exclude<TopicStreamStatus, 'aborted'>

export interface ConversationActivityUpdate {
  topicId: string
  turnId?: string
  target: ConversationNavigationTarget
  status: TopicStreamStatus | null
  changedAt: number
  originDisplayId: number
}

export interface ConversationIslandActivity {
  topicId: string
  turnId?: string
  target: ConversationNavigationTarget
  status: EligibleStatus
  changedAt: number
  originDisplayId: number
  expiresAt?: number
}

export interface ConversationActivitySelection {
  primary?: ConversationIslandActivity
  secondaryCount: number
}

function isTerminal(status: EligibleStatus): status is keyof typeof TERMINAL_TTL_MS {
  return status === 'done' || status === 'error'
}

function priority(status: EligibleStatus): number {
  if (status === 'awaiting-approval') return 3
  if (isTerminal(status)) return 2
  return 1
}

export function reduceActivities(
  activities: Map<string, ConversationIslandActivity>,
  update: ConversationActivityUpdate
): void {
  if (update.status === null || update.status === 'aborted') {
    activities.delete(update.topicId)
    return
  }

  const previous = activities.get(update.topicId)
  const sameTurn = previous?.turnId === update.turnId
  if (previous && sameTurn && previous.status === update.status) return

  const capturesNewOrigin = update.status === 'pending' && (!previous || !sameTurn || isTerminal(previous.status))
  const originDisplayId = previous && !capturesNewOrigin ? previous.originDisplayId : update.originDisplayId
  const expiresAt = isTerminal(update.status) ? update.changedAt + TERMINAL_TTL_MS[update.status] : undefined

  activities.set(update.topicId, {
    topicId: update.topicId,
    turnId: update.turnId,
    target: update.target,
    status: update.status,
    changedAt: update.changedAt,
    originDisplayId,
    expiresAt
  })
}

export function selectPrimaryActivity(
  activities: Map<string, ConversationIslandActivity>,
  now: number
): ConversationActivitySelection {
  let primary: ConversationIslandActivity | undefined
  let eligibleCount = 0

  for (const [topicId, activity] of activities) {
    if (activity.expiresAt !== undefined && activity.expiresAt <= now) {
      activities.delete(topicId)
      continue
    }

    eligibleCount += 1
    if (
      !primary ||
      priority(activity.status) > priority(primary.status) ||
      (priority(activity.status) === priority(primary.status) && activity.changedAt > primary.changedAt)
    ) {
      primary = activity
    }
  }

  return { primary, secondaryCount: primary ? eligibleCount - 1 : 0 }
}
