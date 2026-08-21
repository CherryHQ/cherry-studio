import { type ConversationIslandActivity, selectEligibleActivities } from './activityReducer'

export interface ExpandedActivityState {
  displayId: number
  primaryActivityId: string
  activityIds: string[]
}

export function createExpandedActivityState(
  activities: Map<string, ConversationIslandActivity>,
  now: number,
  displayId: number
): ExpandedActivityState | null {
  const activityIds = selectEligibleActivities(activities, now).map((activity) => activity.topicId)
  if (activityIds.length < 2) return null

  return { displayId, primaryActivityId: activityIds[0], activityIds }
}

export function reconcileExpandedActivityState(
  state: ExpandedActivityState,
  activities: Map<string, ConversationIslandActivity>,
  now: number
): ExpandedActivityState | null {
  const eligibleActivityIds = selectEligibleActivities(activities, now, new Set(state.activityIds)).map(
    (activity) => activity.topicId
  )
  const activityIds = state.activityIds.filter((activityId) => activities.has(activityId))
  const frozenActivityIds = new Set(activityIds)

  activityIds.push(...eligibleActivityIds.filter((activityId) => !frozenActivityIds.has(activityId)))
  if (activityIds.length < 2) return null

  const primaryActivityId = activityIds.includes(state.primaryActivityId) ? state.primaryActivityId : activityIds[0]
  return { ...state, primaryActivityId, activityIds }
}

export function resolveExpandedActivities(
  state: ExpandedActivityState,
  activities: Map<string, ConversationIslandActivity>
): ConversationIslandActivity[] {
  const resolvedActivities: ConversationIslandActivity[] = []

  for (const activityId of state.activityIds) {
    const activity = activities.get(activityId)
    if (activity) resolvedActivities.push(activity)
  }

  return resolvedActivities
}
