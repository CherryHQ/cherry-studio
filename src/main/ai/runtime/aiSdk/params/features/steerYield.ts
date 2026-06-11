import { application } from '@main/core/application'
import type { StopCondition, ToolSet } from 'ai'

import { isAgentSessionTopic } from '../../../../agentSession/topic'
import type { RequestFeature } from '../feature'

/**
 * Yield the running chat turn at the next safe step boundary when a steer message is queued for the
 * topic. The step cap and this condition are OR'd into `stopWhen`; when it fires the turn stops
 * cleanly (persisted as success) and `AiStreamManager` chains a continuation that answers the steer.
 *
 * Chat-only: the `applies` guard excludes agent-session topics — they absorb mid-flight messages
 * through their own runtime queue (`pendingTurns`), not this params-path yield condition.
 */
export const steerYieldFeature: RequestFeature = {
  name: 'steer-yield',
  applies: (scope) => {
    const topicId = scope.request.chatId
    return Boolean(topicId) && !isAgentSessionTopic(topicId as string)
  },
  contributeStopConditions: (scope): StopCondition<ToolSet>[] => {
    const topicId = scope.request.chatId
    if (!topicId) return []
    return [() => application.get('AiStreamManager').hasPendingSteer(topicId)]
  }
}
