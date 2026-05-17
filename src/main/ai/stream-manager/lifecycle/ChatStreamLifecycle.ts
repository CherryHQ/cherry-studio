import { application } from '@main/core/application'
import type { ActiveExecution, TopicStreamStatus } from '@shared/ai/transport'

import type { ActiveStream } from '../types'
import type { StreamLifecycle } from './StreamLifecycle'

/**
 * Chat lifecycle — every behaviour the chat stream surface needs from the
 * manager beyond raw stream orchestration.
 *
 * Owned here (not in `AiStreamManager`) so prompt streams (and any future
 * stateless stream kind) don't need negative "don't broadcast" / "don't
 * grace-clean" flags. Removing the chat policies just means swapping the
 * strategy object.
 *
 * What this implements:
 *  - Cross-window status broadcast (`topic.stream.statuses.${topicId}`)
 *    on `pending → streaming → terminal`. Renderer observers
 *    (`useSharedCache('topic.stream.statuses.…')`) drive sidebar indicators,
 *    backup gates, etc., off of these writes.
 *  - `canAttach: true` — chat windows re-attach across mounts/refresh.
 *  - 30 s grace-period cleanup so a freshly-mounted renderer can still
 *    call `attach` and retrieve the final assistant message.
 *
 * `evictStream` (the manager's "drop without grace" primitive) is invoked
 * via the `evict` callback when the timer fires.
 */
export function createChatStreamLifecycle(gracePeriodMs: number): StreamLifecycle {
  const broadcast = (stream: ActiveStream, status: TopicStreamStatus) => {
    const activeExecutions: ActiveExecution[] = []
    for (const [modelId, exec] of stream.executions) {
      if (exec.status === 'streaming') {
        activeExecutions.push({ executionId: modelId, anchorMessageId: exec.anchorMessageId })
      }
    }
    const cacheService = application.get('CacheService')
    cacheService.setShared(`topic.stream.statuses.${stream.topicId}` as const, { status, activeExecutions })
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
