import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentSessionTopicId } from '../../agentSession/topic'
import { agentChatContextProvider } from '../context/AgentChatContextProvider'
import type { StreamListener } from '../types'

/**
 * Start an agent-session stream from a non-renderer caller.
 *
 * Durable cross-Session delivery is deliberately not supported here. AgentSessionDeliveryService
 * owns its claim, persistence, recovery, and finalization; this facade remains for scheduled and
 * channel turns that need the ordinary runtime admission path.
 */
export type StartAgentSessionRunResult =
  | { mode: 'started' }
  | { mode: 'not-started'; reason: 'busy' | 'session-invalid' }

export async function startAgentSessionRun(input: {
  sessionId: string
  userParts: CherryMessagePart[]
  listeners: StreamListener[]
  headless?: boolean
  /** Recipients authorized only for this run; [] deliberately disables notify. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  requireIdle?: { expectedAgentId: string }
}): Promise<StartAgentSessionRunResult> {
  if (input.listeners.length === 0) {
    throw new Error('startAgentSessionRun requires at least one listener')
  }
  const [primary, ...extras] = input.listeners

  const topicId = buildAgentSessionTopicId(input.sessionId)
  const manager = application.get('AiStreamManager')
  let result: StartAgentSessionRunResult = { mode: 'not-started', reason: 'session-invalid' }

  await manager.withDispatchLock(topicId, async () => {
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

    let prepared
    try {
      prepared = await agentChatContextProvider.prepareAgentSessionDispatch(
        primary,
        {
          trigger: 'submit-message',
          topicId,
          userMessageParts: input.userParts,
          headless: input.headless === true
        },
        { trustedNotifyChannels: input.trustedNotifyChannels },
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
      listeners: input.requireIdle
        ? [primary, ...extras, ...prepared.listeners.filter((listener) => listener.id !== primary.id)]
        : [...prepared.listeners, ...extras],
      siblingsGroupId: prepared.siblingsGroupId,
      lifecycle: prepared.lifecycle
    })
    result = { mode: 'started' }
  })
  return result
}
