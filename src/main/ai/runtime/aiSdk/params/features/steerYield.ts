import { application } from '@application'
import type { StopCondition, ToolSet } from 'ai'

import { trackSteerYieldStopCondition } from '../../loop/toolLoopTermination'
import type { RequestFeature } from '../feature'

/**
 * Yield the running chat turn at the next safe step boundary when a steer message is queued for the
 * topic. The step cap and this condition are OR'd into `stopWhen`; when it fires the turn stops
 * cleanly (persisted as success) and ConversationRuntimeService opens the queued successor turn.
 *
 * Chat-only: the `applies` guard excludes agent-session topics — they absorb mid-flight messages
 * through their own runtime queue (`pendingTurns`), not this params-path yield condition.
 */
export const steerYieldFeature: RequestFeature = {
  name: 'steer-yield',
  applies: (scope) => {
    const topicId = scope.request.chatId
    return Boolean(topicId)
  },
  contributeStopConditions: (scope): StopCondition<ToolSet>[] => {
    const topicId = scope.request.chatId
    if (!topicId) return []
    return [
      trackSteerYieldStopCondition(() => application.get('ConversationRuntimeService').hasPendingChatInput(topicId))
    ]
  }
}
