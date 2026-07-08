import {
  createImageActionBus,
  type ImageActionRequest,
  type ImageActionType
} from '@renderer/utils/message/imageActionBus'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

export type AgentSessionImageActionType = ImageActionType

export type AgentSessionImageActionTarget = Pick<AgentSessionEntity, 'id' | 'name'>

export type AgentSessionImageActionRequest = ImageActionRequest<AgentSessionImageActionTarget, 'session'>

const agentSessionImageActionBus = createImageActionBus<AgentSessionImageActionTarget, 'session'>({
  targetKey: 'session',
  getTargetId: (session) => session.id
})

export function requestAgentSessionImageAction(
  type: AgentSessionImageActionType,
  session: AgentSessionImageActionTarget
): AgentSessionImageActionRequest {
  return agentSessionImageActionBus.requestImageAction(type, session)
}

export function settleAgentSessionImageActionRequest(
  request: AgentSessionImageActionRequest,
  actionPromise: Promise<void> | void
): void {
  agentSessionImageActionBus.settleImageActionRequest(request, actionPromise)
}

export function consumePendingAgentSessionImageActions(
  sessionId: string,
  type?: AgentSessionImageActionType
): AgentSessionImageActionRequest[] {
  return agentSessionImageActionBus.consumePendingImageActions(sessionId, type)
}

export function rejectPendingAgentSessionImageActions(sessionId: string | undefined, reason: unknown): void {
  agentSessionImageActionBus.rejectPendingImageActions(sessionId, reason)
}

export function clearPendingAgentSessionImageActionsForTest(): void {
  agentSessionImageActionBus.clearPendingImageActionsForTest()
}
