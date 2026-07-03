import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

export type AgentSessionImageActionType = 'copy' | 'export'
export type AgentSessionImageActionConsumer = 'visible' | 'capture'

export type AgentSessionImageActionTarget = Pick<AgentSessionEntity, 'id' | 'name'>

export interface AgentSessionImageActionRequest {
  consumer: AgentSessionImageActionConsumer
  id: number
  promise: Promise<void>
  session: AgentSessionImageActionTarget
  type: AgentSessionImageActionType
}

interface RequestAgentSessionImageActionOptions {
  consumer?: AgentSessionImageActionConsumer
  emit?: boolean
}

interface AgentSessionImageActionSettlement {
  reject: (reason?: unknown) => void
  resolve: () => void
}

const AGENT_SESSION_IMAGE_EVENT_NAMES: Record<AgentSessionImageActionType, string> = {
  copy: EVENT_NAMES.COPY_AGENT_SESSION_IMAGE,
  export: EVENT_NAMES.EXPORT_AGENT_SESSION_IMAGE
}

let nextRequestId = 1
let pendingRequests: AgentSessionImageActionRequest[] = []
const settlements = new Map<number, AgentSessionImageActionSettlement>()

export function requestAgentSessionImageAction(
  type: AgentSessionImageActionType,
  session: AgentSessionImageActionTarget,
  options: RequestAgentSessionImageActionOptions = {}
): AgentSessionImageActionRequest {
  let settlement: AgentSessionImageActionSettlement | undefined
  const promise = new Promise<void>((resolve, reject) => {
    settlement = { resolve, reject }
  })
  const request = { consumer: options.consumer ?? 'visible', id: nextRequestId++, promise, type, session }
  settlements.set(request.id, settlement as AgentSessionImageActionSettlement)
  pendingRequests.push(request)
  if (options.emit !== false) {
    void EventEmitter.emit(AGENT_SESSION_IMAGE_EVENT_NAMES[type], session)
  }
  return request
}

export function settleAgentSessionImageActionRequest(
  request: AgentSessionImageActionRequest,
  actionPromise: Promise<void> | void
): void {
  const settlement = settlements.get(request.id)
  if (!settlement) return

  settlements.delete(request.id)
  void Promise.resolve(actionPromise).then(settlement.resolve, settlement.reject)
}

export function consumePendingAgentSessionImageActions(
  sessionId: string,
  type?: AgentSessionImageActionType,
  consumer: AgentSessionImageActionConsumer = 'visible'
): AgentSessionImageActionRequest[] {
  const matches: AgentSessionImageActionRequest[] = []
  const remaining: AgentSessionImageActionRequest[] = []

  for (const request of pendingRequests) {
    if (request.session.id === sessionId && request.consumer === consumer && (!type || request.type === type)) {
      matches.push(request)
    } else {
      remaining.push(request)
    }
  }

  pendingRequests = remaining
  return matches
}

export function rejectPendingAgentSessionImageActions(
  sessionId: string | undefined,
  reason: unknown,
  consumer?: AgentSessionImageActionConsumer
): void {
  const remaining: AgentSessionImageActionRequest[] = []

  for (const request of pendingRequests) {
    if ((sessionId === undefined || request.session.id === sessionId) && (!consumer || request.consumer === consumer)) {
      const settlement = settlements.get(request.id)
      settlements.delete(request.id)
      settlement?.reject(reason)
    } else {
      remaining.push(request)
    }
  }

  pendingRequests = remaining
}

export function clearPendingAgentSessionImageActionsForTest(): void {
  pendingRequests = []
  settlements.clear()
  nextRequestId = 1
}
