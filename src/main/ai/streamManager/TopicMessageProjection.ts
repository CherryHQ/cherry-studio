import { MessageProjection } from '@main/ai/messages/MessageProjection'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { ProjectedExecution, TopicProjectionState } from '@shared/ai/messageProjection'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import { finalizeInterruptedParts } from './persistence/PersistenceBackend'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from './types'

/** One live overlay per topic; saved history stays in its existing message store. */
export class TopicMessageProjection extends MessageProjection<TopicProjectionState> implements StreamListener {
  readonly id = 'message-projection'
  private readonly executions = new Map<UniqueModelId, ProjectedExecution>()
  private readonly messages = new Map<UniqueModelId, CherryUIMessage>()

  constructor(
    readonly topicId: string,
    private readonly project: (message: CherryUIMessage) => CherryUIMessage
  ) {
    super({ kind: 'topic', topicId, executions: [], messages: [] })
  }

  begin(executions: readonly ActiveExecution[], replace: boolean): void {
    this.flush()
    if (replace) {
      this.executions.clear()
      this.messages.clear()
    }
    for (const execution of executions) {
      this.executions.set(execution.executionId, {
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        anchorMessageId: execution.anchorMessageId,
        status: 'active'
      })
      this.messages.delete(execution.executionId)
    }
    this.publish(true)
  }

  accumulate(modelId: UniqueModelId, attemptId: number, message: CherryUIMessage): void {
    const execution = this.executions.get(modelId)
    if (!execution || execution.attemptId !== attemptId || execution.status !== 'active') return
    this.setMessage(execution, message)
    this.publish()
  }

  onChunk(): void {}
  isAlive(): boolean {
    return true
  }
  onDone(result: StreamDoneResult): void {
    this.complete(result, 'done')
  }
  onPaused(result: StreamPausedResult): void {
    this.complete(result, 'paused')
  }
  onError(result: StreamErrorResult): void {
    this.complete(result, result.persistence?.status === 'failed' ? 'unresolved' : 'error')
  }

  private complete(
    result: StreamDoneResult | StreamPausedResult | StreamErrorResult,
    status: ProjectedExecution['status']
  ): void {
    for (const execution of this.executions.values()) {
      if (result.modelId && result.modelId !== execution.executionId) continue
      if (result.attemptId !== undefined && result.attemptId !== execution.attemptId) continue
      let message = result.finalMessage ?? this.messages.get(execution.executionId)
      if (result.status === 'error' && !message?.parts.some((part) => part.type === 'data-error')) {
        message = {
          id: message?.id ?? execution.anchorMessageId ?? crypto.randomUUID(),
          role: 'assistant',
          ...message,
          parts: [
            ...(message?.parts ?? []),
            {
              type: 'data-error',
              data: {
                ...result.error,
                executionFailure: result.failure ?? toExecutionFailure(result.error, result.modelId)
              }
            }
          ]
        }
      }
      if (message)
        this.setMessage(execution, {
          ...message,
          parts: finalizeInterruptedParts(message.parts, result.status)
        })
      this.executions.set(execution.executionId, { ...this.executions.get(execution.executionId)!, status })
    }
    this.publish(true)
  }

  private setMessage(execution: ProjectedExecution, message: CherryUIMessage): void {
    const projected = this.project({ ...message, id: execution.anchorMessageId ?? message.id })
    this.messages.set(execution.executionId, projected)
    this.executions.set(execution.executionId, { ...execution, messageId: projected.id })
  }

  private publish(immediate = false): void {
    this.update(
      {
        kind: 'topic',
        topicId: this.topicId,
        executions: [...this.executions.values()],
        messages: [...this.messages.values()]
      },
      immediate
    )
  }
}
