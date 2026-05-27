import { application } from '@main/core/application'
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
      if (exec.awaitingApproval) awaitingApprovalAnchors.push(entry)
    }
    const cacheService = application.get('CacheService')
    const key = `topic.stream.statuses.${stream.topicId}` as const
    const prev = cacheService.getShared(key)
    const lastCompletedAt = status === 'done' ? Date.now() : prev?.lastCompletedAt
    cacheService.setShared(key, {
      status,
      activeExecutions,
      awaitingApprovalAnchors,
      lastCompletedAt
    })
  }

  return {
    name: 'chat',
    onCreated(stream) {
      broadcast(stream, 'pending')
    },
    onPromotedToStreaming(stream) {
      broadcast(stream, 'streaming')
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
