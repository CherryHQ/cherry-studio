import { application } from '@application'
import { loggerService } from '@logger'
import type { ActiveExecution, TopicStreamStatus } from '@shared/ai/transport'

import type { ActiveStream } from '../types'
import type { StreamLifecycle } from './StreamLifecycle'

const logger = loggerService.withContext('ChatStreamLifecycle')

/**
 * Chat strategy: cross-window status broadcast (`topic.stream.statuses.<topicId>`),
 * attach re-enabled, 30 s grace-period before eviction.
 */
export function createChatStreamLifecycle(gracePeriodMs: number): StreamLifecycle {
  const broadcast = (stream: ActiveStream, status: TopicStreamStatus) => {
    try {
      const activeExecutions: ActiveExecution[] = []
      const awaitingApprovalAnchors: ActiveExecution[] = []

      for (const [modelId, exec] of stream.executions) {
        const entry: ActiveExecution = {
          executionId: modelId,
          attemptId: exec.attemptId,
          attemptVersion: exec.attemptVersion,
          anchorMessageId: exec.anchorMessageId,
          ...(exec.seedFromEmpty ? { seedFromEmpty: true } : {})
        }
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
    } catch (error) {
      // Stream registration/execution is the commit point. Cache convergence is observational and
      // must not turn a successfully started stream into a failed IPC response.
      logger.warn('Failed to broadcast chat stream status', { topicId: stream.topicId, status, error })
    }
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
    onActiveExecutionsChanged(stream) {
      broadcast(stream, stream.status)
    },
    onTerminal(stream) {
      broadcast(stream, stream.status)
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
