import { useEffect, useEffectEvent, useMemo } from 'react'

import { messageProjectionService } from '@renderer/services/aiTransport'
import type { ExecutionFinishEvent } from '@renderer/types/message'
import { projectedReplies } from '@renderer/utils/message/projectedReplies'
import type { ActiveExecution } from '@shared/ai/transport'

export function useTopicCompletion(
  topicId: string,
  expected: readonly ActiveExecution[],
  onFinish: (executionId: string, event: ExecutionFinishEvent) => void
) {
  const scope = useMemo(() => ({ topicId, seen: new Set<number>() }), [topicId])
  const complete = useEffectEvent((subscribedTopicId: string) => {
    if (subscribedTopicId !== scope.topicId) return
    const { seen } = scope
    const view = messageProjectionService.getSnapshot({ kind: 'topic', topicId }).view
    if (view?.kind !== 'topic') return
    for (const id of seen) if (!view.executions.some((execution) => execution.attemptId === id)) seen.delete(id)
    for (const { execution, message } of projectedReplies(view, expected)) {
      if (execution.status === 'active' || seen.has(execution.attemptId)) continue
      seen.add(execution.attemptId)
      onFinish(execution.executionId, {
        attemptId: execution.attemptId,
        userMessageId: execution.userMessageId,
        message,
        isAbort: execution.status === 'paused',
        isError: execution.status === 'unresolved' || execution.status === 'error'
      })
    }
  })
  useEffect(() => {
    if (!topicId) return
    const receive = () => complete(topicId)
    const off = messageProjectionService.subscribe({ kind: 'topic', topicId }, receive)
    receive()
    return off
  }, [topicId])
}
