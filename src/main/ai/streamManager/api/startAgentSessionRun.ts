import { application } from '@application'
import { ConversationAdmissionError } from '@main/ai/conversation'
import {
  ConversationAdmissionReason,
  ConversationBlockReason,
  type ConversationInputId,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  type ConversationTurnId
} from '@shared/ai/conversation'
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
  Injected = 'injected',
  Blocked = 'blocked'
}

export enum StartAgentSessionRunRejection {
  Busy = 'busy',
  SessionInvalid = 'session-invalid',
  Paused = 'paused'
}

export type StartAgentSessionRunResult =
  | { mode: StartAgentSessionRunMode.Started; turnId: ConversationTurnId }
  | { mode: StartAgentSessionRunMode.Injected; inputId: ConversationInputId }
  | { mode: StartAgentSessionRunMode.Blocked; reason: StartAgentSessionRunRejection }

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
  try {
    const result = await runtime.dispatch(
      primary,
      {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation,
        userMessageParts: input.userParts,
        headless: input.headless === true
      },
      extras,
      input.requireIdle ? { requireIdle: true, expectedAgentId: input.requireIdle.expectedAgentId } : {}
    )
    if (result.mode === ConversationOpenMode.Blocked) {
      return {
        mode: StartAgentSessionRunMode.Blocked,
        reason:
          result.reason === ConversationBlockReason.Paused
            ? StartAgentSessionRunRejection.Paused
            : StartAgentSessionRunRejection.SessionInvalid
      }
    }
    if (result.mode === ConversationOpenMode.Injected) {
      return { mode: StartAgentSessionRunMode.Injected, inputId: result.inputId }
    }
    const turnId = result.activeExecutions?.[0]?.turnId
    if (!turnId) throw new Error('Started Agent Conversation admission did not return its owning turn')
    return { mode: StartAgentSessionRunMode.Started, turnId }
  } catch (error) {
    if (error instanceof ConversationAdmissionError && error.reason === ConversationAdmissionReason.ConversationBusy) {
      return { mode: StartAgentSessionRunMode.Blocked, reason: StartAgentSessionRunRejection.Busy }
    }
    if (
      isDataApiError(error) &&
      (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.CONCURRENT_MODIFICATION)
    ) {
      return { mode: StartAgentSessionRunMode.Blocked, reason: StartAgentSessionRunRejection.SessionInvalid }
    }
    throw error
  }
}
