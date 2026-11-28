import { useEffect, useEffectEvent } from 'react'

import { messageProjectionService } from '@renderer/services/aiTransport'
import { autoReadService } from '@renderer/services/voice'
import type { ExecutionContentUpdate } from '@renderer/types/message'
import { projectedReplies, type ProjectedReply, type TopicView } from '@renderer/utils/message/projectedReplies'
import type { ProjectedExecution } from '@shared/ai/messageProjection'
import type { ActiveExecution } from '@shared/ai/transport'

export function useTopicSpeech(
  topicId: string,
  expected: readonly ActiveExecution[],
  enabled: boolean,
  onContent: (executionId: string, event: ExecutionContentUpdate) => void
) {
  const replies = useEffectEvent((view: TopicView) => projectedReplies(view, expected))
  const deliver = useEffectEvent((execution: ProjectedExecution, event: ExecutionContentUpdate) => {
    if (!expected.some((item) => item.executionId === execution.executionId && item.attemptId > execution.attemptId))
      onContent(execution.executionId, event)
  })
  useEffect(() => {
    if (!enabled || !topicId) return
    const target = { kind: 'topic' as const, topicId }
    let speakers = new Map<string, ProjectedReply>()
    const baseline = () => {
      const view = messageProjectionService.getSnapshot(target).view
      const previous = speakers
      speakers = new Map()
      if (view?.kind !== 'topic') return
      for (const reply of replies(view)) {
        const { execution, message } = reply
        if (execution.status !== 'active') continue
        speakers.set(message.id, reply)
        const before = previous.get(message.id)
        if (before?.message !== message || before.execution.attemptId !== execution.attemptId)
          deliver(execution, {
            type: 'snapshot',
            attemptId: execution.attemptId,
            message: messageProjectionService.readMessage(target, message)
          })
      }
    }
    const off = messageProjectionService.subscribe(target, baseline, (change) => {
      const execution = speakers.get(change.messageId)?.execution
      if (execution) deliver(execution, { ...change, attemptId: execution.attemptId })
    })
    baseline()
    return () => {
      off()
      autoReadService.cancelScope(topicId)
    }
  }, [enabled, topicId])
}
