import { application } from '@application'
import type { ActiveExecution, TopicStreamStatus } from '@shared/ai/transport'

import type { ActiveStream } from '../types'
import type { StreamLifecycle } from './StreamLifecycle'

/**
 * Chat strategy: cross-window status broadcast (`topic.stream.statuses.<topicId>`),
 * attach re-enabled, 30 s grace-period before eviction.
 */
export function createChatStreamLifecycle(gracePeriodMs: number): StreamLifecycle {
  const broadcast = (stream: ActiveStream, status: TopicStreamStatus) => {
    const activeExecutions: ActiveExecution[] = []
    const awaitingApprovalAnchors: ActiveExecution[] = []

    for (const [modelId, exec] of stream.executions) {
      const entry: ActiveExecution = { executionId: modelId, anchorMessageId: exec.anchorMessageId }
      if (exec.status === 'streaming') activeExecutions.push(entry)
      // Main-side authoritative approval-anchor identity; renderer reads this
      // instead of inferring from `parts` / SWR-lagged status.
      if (exec.pendingApprovalToolCallIds?.size) awaitingApprovalAnchors.push(entry)
    }

    const cacheService = application.get('CacheService')
    const key = `topic.stream.statuses.${stream.topicId}` as const
    const prev = cacheService.getShared(key)
    const lastCompletedAt = status === 'done' ? Date.now() : prev?.lastCompletedAt
    cacheService.setShared(key, {
      status,
      turnId: stream.turnId,
      activeExecutions,
      awaitingApprovalAnchors,
      lastCompletedAt
    })
    return lastCompletedAt
  }

  return {
    name: 'chat',
    onCreated(stream) {
      broadcast(stream, 'pending')
    },
    onPromotedToStreaming(stream) {
      broadcast(stream, 'streaming')
    },
    onApprovalPendingChanged(stream) {
      broadcast(stream, stream.status)
    },
    onTerminal(stream) {
      const completedAt = broadcast(stream, stream.status)
      if (stream.status === 'done' && completedAt !== undefined && stream.completionTarget) {
        application.get('NotificationService').notifyTaskCompletion({
          topicId: stream.topicId,
          turnId: stream.turnId,
          completedAt,
          target: stream.completionTarget
        })
      }
    },
    canAttach() {
      return true
    },
    cleanup(stream, evict) {
      stream.expiresAt = Date.now() + gracePeriodMs
      stream.cleanupTimer = setTimeout(evict, gracePeriodMs)
    }
  }
}
