import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { ConversationKind, ConversationOpenTrigger } from '@shared/ai/conversation'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { StreamListener } from '../types'

/**
 * Start an agent-session stream from a non-renderer caller.
 *
 * Durable cross-Session delivery is deliberately not supported here. AgentSessionDeliveryService
 * owns its claim, persistence, recovery, and finalization; this facade remains for scheduled and
 * channel turns that need the ordinary runtime admission path.
 */
export enum StartAgentSessionRunMode {
  Started = 'started',
  NotStarted = 'not-started'
}

export enum StartAgentSessionRunRejection {
  Busy = 'busy',
  SessionInvalid = 'session-invalid'
}

export type StartAgentSessionRunResult =
  | { mode: StartAgentSessionRunMode.Started }
  | { mode: StartAgentSessionRunMode.NotStarted; reason: StartAgentSessionRunRejection }

export async function startAgentSessionRun(input: {
  sessionId: string
  userParts: CherryMessagePart[]
  listeners: StreamListener[]
  headless?: boolean
  requireIdle?: { expectedAgentId: string }
}): Promise<StartAgentSessionRunResult> {
  if (input.listeners.length === 0) {
    throw new Error('startAgentSessionRun requires at least one listener')
  }
  const [primary, ...extras] = input.listeners

  const conversation = { kind: ConversationKind.Agent, id: input.sessionId } as const
  const runtime = application.get('ConversationRuntimeService')
  if (runtime.isWriteQuiesced) {
    throw new Error('ConversationRuntimeService is write-quiesced; refusing a new agent-session turn')
  }
  if (input.requireIdle) {
    if (runtime.hasLiveConversation(conversation)) {
      return { mode: StartAgentSessionRunMode.NotStarted, reason: StartAgentSessionRunRejection.Busy }
    }
    try {
      const session = agentSessionService.getById(input.sessionId)
      if (session.agentId !== input.requireIdle.expectedAgentId) {
        return { mode: StartAgentSessionRunMode.NotStarted, reason: StartAgentSessionRunRejection.SessionInvalid }
      }
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return { mode: StartAgentSessionRunMode.NotStarted, reason: StartAgentSessionRunRejection.SessionInvalid }
      }
      throw error
    }
  }
  await runtime.dispatch(
    primary,
    {
      trigger: ConversationOpenTrigger.SubmitMessage,
      conversation,
      userMessageParts: input.userParts,
      headless: input.headless === true
    },
    extras
  )
  return { mode: StartAgentSessionRunMode.Started }
}
