import { isToolUIPart } from 'ai'

import { MessageProjection } from '@main/ai/messages/MessageProjection'
import type { PublishedPartPatch } from '@main/utils/messageOutputProjection'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { projectPersistenceFailures } from '@shared/ai/messageProjection'
import type {
  MessageViewPatch,
  MessageProjectionView,
  ProjectedExecution,
  TopicProjectionState,
  TimelinePlacement
} from '@shared/ai/messageProjection'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ErrorPartData } from '@shared/data/types/uiParts'

import { finalizeInterruptedParts } from './persistence/PersistenceBackend'
import { projectStreamMessageForRenderer } from './rendererPayload'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from './types'

/** One live overlay per topic; saved history stays in its existing message store. */
export class TopicMessageProjection extends MessageProjection<TopicProjectionState> implements StreamListener {
  readonly id = 'message-projection'
  private readonly executions = new Map<UniqueModelId, ProjectedExecution>()
  private readonly messages = new Map<UniqueModelId, CherryUIMessage>()
  private agent?: { modelId: UniqueModelId; readMessage: () => CherryUIMessage | undefined }

  constructor(
    readonly topicId: string,
    /** Accepts a native message and returns an immutable compact projection. */
    private readonly project: (message: CherryUIMessage) => CherryUIMessage
  ) {
    super({ kind: 'topic', topicId, executions: [], messages: [] })
  }

  begin(executions: readonly ActiveExecution[], replace: boolean): void {
    this.flush()
    const previousAgent = this.agent
    if (replace || executions.some((execution) => execution.executionId === previousAgent?.modelId))
      this.agent = undefined
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
    if (previousAgent && !this.agent) this.relayAcceptedMessages([], [], this.state())
    else this.publish(true)
  }

  readAgentFrom(modelId: UniqueModelId, attemptId: number, readMessage: () => CherryUIMessage | undefined): void {
    if (this.executions.get(modelId)?.attemptId !== attemptId) return
    this.flush()
    this.agent = { modelId, readMessage }
  }

  override snapshot(): MessageProjectionView<TopicProjectionState> {
    const view = super.snapshot()
    const agent = this.agent
    const execution = agent && this.executions.get(agent.modelId)
    const id = execution?.messageId
    const message = id && agent?.readMessage()
    return projectPersistenceFailures(
      message ? { ...view, messages: [projectStreamMessageForRenderer(this.topicId, { ...message, id })] } : view
    )
  }

  accumulate(modelId: UniqueModelId, attemptId: number, message: CherryUIMessage): void {
    const execution = this.executions.get(modelId)
    if (!execution || execution.attemptId !== attemptId || execution.status !== 'active') return
    if (this.agent?.modelId === modelId) this.relayAgentMessage(execution, message)
    else {
      this.setMessage(execution, message)
      this.publish()
    }
  }

  refreshAgentMessage(modelId: UniqueModelId, attemptId: number): void {
    const execution = this.executions.get(modelId)
    if (this.agent?.modelId !== modelId || execution?.attemptId !== attemptId || execution.status !== 'active') return
    const message = execution.messageId && this.agent.readMessage()
    if (message) this.relayAgentMessage(execution, message, false)
  }

  relayAgentPart(modelId: UniqueModelId, attemptId: number, change: PublishedPartPatch<TimelinePlacement>): void {
    const execution = this.executions.get(modelId)
    if (this.agent?.modelId !== modelId || execution?.attemptId !== attemptId || execution.status !== 'active') return
    if (execution.messageId) this.publishParts([change])
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
    if (result.persistence?.status === 'failed') {
      this.persistenceFailed(result.modelId, result.attemptId, result.userMessageId, {
        ...result.error,
        executionFailure: result.persistence.failure
      })
    } else this.complete(result, 'error')
  }

  private persistenceFailed(
    modelId: UniqueModelId | undefined,
    attemptId: number | undefined,
    userMessageId: string | undefined,
    persistenceError: ErrorPartData
  ): void {
    this.flush()
    for (const execution of this.executions.values()) {
      if (
        (modelId && modelId !== execution.executionId) ||
        (attemptId !== undefined && attemptId !== execution.attemptId)
      )
        continue
      const sdkBody = this.messages.get(execution.executionId)
      if (sdkBody) this.setMessage(execution, { ...sdkBody, parts: finalizeInterruptedParts(sdkBody.parts, 'error') })
      this.executions.set(execution.executionId, {
        ...execution,
        status: 'unresolved',
        savedMessageId: undefined,
        userMessageId,
        messageId: execution.messageId ?? execution.anchorMessageId ?? crypto.randomUUID(),
        persistenceError
      })
    }
    this.publish(true)
  }

  private complete(
    result: StreamDoneResult | StreamPausedResult | StreamErrorResult,
    status: 'done' | 'paused' | 'error'
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
      if (message) {
        message = {
          ...message,
          parts: finalizeInterruptedParts(message.parts, result.status)
        }
        if (this.agent?.modelId !== execution.executionId) this.setMessage(execution, message)
      }
      const terminal = {
        ...this.executions.get(execution.executionId)!,
        userMessageId: result.userMessageId,
        status,
        savedMessageId: result.persistence?.status === 'saved' ? result.persistence.message.messageId : undefined
      }
      this.executions.set(execution.executionId, terminal)
      if (message && this.agent?.modelId === execution.executionId) this.relayAgentMessage(terminal, message)
    }
    this.publish(true)
  }

  private relayAgentMessage(execution: ProjectedExecution, message: CherryUIMessage, invalidateResults = true): void {
    const id = execution.anchorMessageId ?? message.id
    if (execution.messageId !== id) this.executions.set(execution.executionId, { ...execution, messageId: id })
    const patches: MessageViewPatch[] = [
      { type: 'message', message: projectStreamMessageForRenderer(this.topicId, { ...message, id }) }
    ]
    if (invalidateResults) {
      message.parts.forEach((part, index) => {
        if (!isToolUIPart(part)) return
        const partId = message.partIds?.[index]
        patches.push({
          type: 'tool-result',
          ref: { topicId: this.topicId, messageId: id, toolCallId: part.toolCallId, partId }
        })
      })
    }
    this.relayAcceptedMessages(patches, execution.messageId !== id ? [id] : undefined, this.state())
  }

  private setMessage(execution: ProjectedExecution, message: CherryUIMessage): void {
    const id = execution.anchorMessageId ?? message.id
    this.messages.set(execution.executionId, this.project({ ...message, id }))
    if (execution.messageId !== id) this.executions.set(execution.executionId, { ...execution, messageId: id })
  }

  private publish(immediate = false): void {
    this.updateAccepted(
      () => ({
        ...this.state(),
        messages: [...this.messages.values()]
      }),
      immediate
    )
  }

  private state(): TopicProjectionState {
    return { kind: 'topic', topicId: this.topicId, executions: [...this.executions.values()] }
  }
}
