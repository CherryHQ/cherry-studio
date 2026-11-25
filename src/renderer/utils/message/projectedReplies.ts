import type { MessageProjectionView, ProjectedExecution, TopicProjectionState } from '@shared/ai/messageProjection'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

export type TopicView = MessageProjectionView<TopicProjectionState>
export type ProjectedReply = { execution: ProjectedExecution; message: CherryUIMessage }

/** Join only the current topic projection. A newer optimistic attempt may precede its first Main frame. */
export function projectedReplies(view: TopicView | null, expected: readonly ActiveExecution[]): ProjectedReply[] {
  if (!view) return []
  const executions = new Map(view.executions.map((item) => [item.messageId, item]))
  return view.messages.flatMap((message) => {
    const execution = executions.get(message.id)
    if (
      !execution ||
      message.role !== 'assistant' ||
      expected.some((item) => item.executionId === execution.executionId && item.attemptId > execution.attemptId)
    )
      return []
    return [{ execution, message }]
  })
}
