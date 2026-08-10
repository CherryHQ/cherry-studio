import { application } from '@application'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentSessionTopicId } from '../../agentSession/topic'
import { agentChatContextProvider } from '../context/AgentChatContextProvider'
import type { StreamListener } from '../types'

const logger = loggerService.withContext('AgentSessionDelivery')

class AgentSessionDeliverySubscriber implements StreamListener {
  readonly id: string

  constructor(messageId: string) {
    this.id = `agent-delivery:${messageId}`
  }

  onChunk(): void {}

  onDone(): void {}

  onPaused(): void {}

  onError(): void {}

  isAlive(): boolean {
    return true
  }
}

/**
 * Start (or inject into) an agent-session stream from a non-renderer caller.
 *
 * Encapsulates the user/assistant persistence + driver turn-begin done by
 * `AgentChatContextProvider`, so schedulers, channel inbound handlers, and
 * other backend triggers go through the same path as the renderer instead
 * of hand-rolling a `manager.send` call.
 *
 * The first listener is treated as the primary subscriber (gets the
 * `runtime.listeners` augmentation from the context provider); any
 * additional listeners are appended verbatim.
 *
 * Lives alongside `dispatch.ts` because stream-manager already owns the
 * downward dependency on agent-session (`AgentChatContextProvider` imports
 * ai/runtime + agent-session/topic). Putting this facade here
 * keeps the direction one-way; if it lived in agent-session/ the package
 * graph would loop back through stream-manager/context.
 */
export type StartAgentSessionRunResult =
  | { mode: 'started'; disposition?: 'queued' | 'delivering' }
  | { mode: 'not-started'; reason: 'busy' | 'session-invalid' }

export async function startAgentSessionRun(input: {
  sessionId: string
  userParts: CherryMessagePart[]
  listeners: StreamListener[]
  headless?: boolean
  requireIdle?: { expectedAgentId: string }
  /** Already-persisted Main-authored user row for cross-session delivery. */
  deliveryMessage?: AgentSessionMessageEntity
  /** Persist and run as a later FIFO turn; never redirect into the current turn. */
  queueOnly?: boolean
}): Promise<StartAgentSessionRunResult> {
  if (input.listeners.length === 0) {
    throw new Error('startAgentSessionRun requires at least one listener')
  }
  const [primary, ...extras] = input.listeners

  const topicId = buildAgentSessionTopicId(input.sessionId)
  const manager = application.get('AiStreamManager')
  let result: StartAgentSessionRunResult = { mode: 'not-started', reason: 'session-invalid' }

  // Hold the per-topic dispatch lock around the whole `hasLiveStream → prepareDispatch
  // (writes a PENDING placeholder) → send` window, the same as the renderer's `dispatch()`.
  // Two backend triggers (scheduled tasks, channel inbound) can fire on one session topic
  // concurrently — or race a renderer open — and without this both could observe no live
  // stream and each write a placeholder, orphaning one as a permanently "thinking" row.
  await manager.withDispatchLock(topicId, async () => {
    // Write-quiesce admission gate (backup restore), re-checked under the lock and BEFORE
    // `prepareDispatch` writes the user/pending-assistant rows. Both callers handle the
    // rejection: an `agent.task` job settles failed-retryable; channel inbound notifies the
    // user — and per the restore orchestration order, channel batches are flushed and
    // admitted before the AI pause, so this throw only fires for out-of-order callers.
    if (manager.isWriteQuiesced) {
      throw new Error(
        'AiStreamManager is write-quiesced (backup restore in progress); refusing a new agent-session turn'
      )
    }

    if (input.requireIdle) {
      if (
        manager.hasLiveStream(topicId) ||
        application.get('AgentSessionRuntimeService').isSessionBusy(input.sessionId)
      ) {
        result = { mode: 'not-started', reason: 'busy' }
        return
      }
      try {
        const session = agentSessionService.getById(input.sessionId)
        if (session.agentId !== input.requireIdle.expectedAgentId) {
          result = { mode: 'not-started', reason: 'session-invalid' }
          return
        }
      } catch (error) {
        if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
          result = { mode: 'not-started', reason: 'session-invalid' }
          return
        }
        throw error
      }
    }

    const wasBusy = application.get('AgentSessionRuntimeService').isSessionBusy(input.sessionId)
    let prepared
    try {
      prepared = await agentChatContextProvider.prepareDispatch(
        primary,
        {
          trigger: 'submit-message',
          topicId,
          userMessageParts: input.userParts,
          headless: input.headless === true,
          agentDeliveryMessage: input.deliveryMessage,
          agentDeliveryQueueOnly: input.queueOnly === true
        },
        {
          hasLiveStream: false,
          requireIdle: input.requireIdle !== undefined,
          expectedAgentId: input.requireIdle?.expectedAgentId
        }
      )
    } catch (error) {
      if (input.requireIdle && isDataApiError(error) && error.code === ErrorCode.RESOURCE_LOCKED) {
        result = { mode: 'not-started', reason: 'busy' }
        return
      }
      if (input.requireIdle && isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        result = { mode: 'not-started', reason: 'session-invalid' }
        return
      }
      throw error
    }

    manager.send({
      topicId: prepared.topicId,
      models: prepared.models,
      // In require-idle mode the primary task listener must deactivate the task/channel listeners
      // before the runtime terminal listener can queue a successor. Preserve ordinary caller order.
      listeners: input.requireIdle
        ? [primary, ...extras, ...prepared.listeners.filter((listener) => listener.id !== primary.id)]
        : [...prepared.listeners, ...extras],
      siblingsGroupId: prepared.siblingsGroupId,
      lifecycle: prepared.lifecycle
    })
    const disposition = wasBusy || input.queueOnly ? 'queued' : 'delivering'
    if (input.deliveryMessage?.delivery) {
      const turnRef = disposition === 'delivering' ? prepared.models[0]?.request.messageId : undefined
      agentSessionMessageService.transitionSessionDelivery(input.sessionId, input.deliveryMessage.id, disposition, {
        expected: ['accepted', 'queued'],
        ...(turnRef ? { turnRef } : {})
      })
    }
    result = input.deliveryMessage ? { mode: 'started', disposition } : { mode: 'started' }
  })
  return result
}

export async function dispatchAcceptedAgentSessionDelivery(
  message: AgentSessionMessageEntity
): Promise<'queued' | 'delivering'> {
  if (!message.delivery) throw new Error(`Message ${message.id} has no delivery envelope`)
  try {
    const result = await startAgentSessionRun({
      sessionId: message.sessionId,
      userParts: message.data.parts ?? [],
      listeners: [new AgentSessionDeliverySubscriber(message.id)],
      headless: true,
      deliveryMessage: message,
      queueOnly: message.delivery.mode === 'queue' || message.delivery.replyPolicy === 'completion'
    })
    if (result.mode !== 'started') {
      if (result.reason === 'session-invalid') {
        throw new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', 'Target Session cannot start an Agent turn')
      }
      throw new Error(`Delivery was not started: ${result.reason}`)
    }
    if (!result.disposition) throw new Error('Delivery started without a disposition')
    return result.disposition
  } catch (error) {
    if (error instanceof AgentSessionDeliveryRoutingError) {
      const result = agentSessionMessageService.failSessionDelivery(message, {
        code: error.code,
        message: error.message
      })
      if (result) {
        void application
          .get('AiStreamManager')
          .dispatchAgentSessionDelivery(result)
          .catch((dispatchError) => {
            logger.warn('Failed to dispatch Agent Session routing failure result', {
              resultMessageId: result.id,
              error: dispatchError
            })
          })
      }
    }
    throw error
  }
}

export async function recoverAcceptedAgentSessionDeliveries(): Promise<void> {
  const messages = agentSessionMessageService.listRecoverableSessionDeliveries()
  if (messages.length === 0) return
  logger.info('Recovering durable agent-session deliveries', { count: messages.length })
  for (const message of messages) {
    try {
      if (message.delivery?.status === 'delivering') {
        const turnRef = message.delivery.turnRef
        if (!turnRef) {
          agentSessionMessageService.transitionSessionDelivery(message.sessionId, message.id, 'accepted', {
            expected: ['delivering']
          })
        } else {
          let assistant: AgentSessionMessageEntity | null = null
          try {
            assistant = agentSessionMessageService.getSessionMessage(message.sessionId, turnRef)
          } catch (error) {
            if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) throw error
          }
          if (assistant?.status === 'pending') {
            agentSessionMessageService.markMessagesError([assistant.id])
            const result = agentSessionMessageService.finalizeSessionDelivery({
              requestSessionId: message.sessionId,
              requestMessageId: message.id,
              assistantMessageId: assistant.id,
              outcome: 'interrupted'
            })
            if (result) await dispatchAcceptedAgentSessionDelivery(result)
            continue
          }
          if (assistant) {
            const result = agentSessionMessageService.finalizeSessionDelivery({
              requestSessionId: message.sessionId,
              requestMessageId: message.id,
              assistantMessageId: assistant.id,
              outcome:
                assistant.status === 'success' ? 'success' : assistant.status === 'paused' ? 'interrupted' : 'failed'
            })
            if (result) await dispatchAcceptedAgentSessionDelivery(result)
            continue
          }
        }
      }
      await dispatchAcceptedAgentSessionDelivery(message)
    } catch (error) {
      logger.warn('Failed to recover agent-session delivery', {
        deliveryId: message.id,
        sessionId: message.sessionId,
        error
      })
    }
  }
}
