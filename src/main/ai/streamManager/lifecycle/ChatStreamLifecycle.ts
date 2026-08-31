import { application } from '@application'
import { loggerService } from '@logger'
import type { ActiveExecution, StallReason, TopicStreamStatus } from '@shared/ai/transport'

import type { ActiveStream, ConversationCompletedEvent } from '../types'
import type { StreamLifecycle } from './StreamLifecycle'

const logger = loggerService.withContext('ChatStreamLifecycle')

/**
 * Chat strategy: cross-window status broadcast (`topic.stream.statuses.<topicId>`),
 * main-only persistent-conversation completion event, attach re-enabled, and a
 * 30 s grace-period before eviction.
 */
export function createChatStreamLifecycle(
  gracePeriodMs: number,
  onConversationCompleted: (event: ConversationCompletedEvent) => void
): StreamLifecycle {
  const broadcast = (stream: ActiveStream, status: TopicStreamStatus) => {
    const completedAt = status === 'done' ? Date.now() : undefined
    try {
      const activeExecutions: ActiveExecution[] = []
      const awaitingApprovalAnchors: ActiveExecution[] = []
      let stalled = false
      let stalledReason: StallReason | undefined

      for (const [modelId, exec] of stream.executions) {
        const entry: ActiveExecution = {
          executionId: modelId,
          attemptId: exec.attemptId,
          anchorMessageId: exec.anchorMessageId,
          ...(exec.seedFromEmpty ? { seedFromEmpty: true } : {})
        }
        if (exec.status === 'streaming') activeExecutions.push(entry)
        // Main-side authoritative approval-anchor identity; renderer reads this
        // instead of inferring from `parts` / SWR-lagged status.
        if (exec.pendingApprovalToolCallIds?.size) awaitingApprovalAnchors.push(entry)
        // Collect stall state from any stalled execution
        if (exec.stalled) {
          stalled = true
          stalledReason = stalledReason ?? exec.stalledReason
        }
      }

      const cacheService = application.get('CacheService')
      const key = `topic.stream.statuses.${stream.topicId}` as const
      const prev = cacheService.getShared(key)
      const lastCompletedAt = completedAt ?? prev?.lastCompletedAt
      cacheService.setShared(key, {
        status,
        turnId: stream.turnId,
        activeExecutions,
        awaitingApprovalAnchors,
        lastCompletedAt,
        stalled: stalled || undefined,
        stalledReason
      })
    } catch (error) {
      // Stream registration/execution is the commit point. Cache convergence is observational and
      // must not turn a successfully started stream into a failed IPC response.
      logger.warn('Failed to broadcast chat stream status', { topicId: stream.topicId, status, error })
    }
    return completedAt
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
    onStallChanged(stream) {
      broadcast(stream, stream.status)
    },
    onTerminal(stream) {
      const completedAt = broadcast(stream, stream.status)
      if (stream.status === 'done' && completedAt !== undefined && stream.isPersistentConversation) {
        onConversationCompleted({
          topicId: stream.topicId,
          turnId: stream.turnId,
          completedAt
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
