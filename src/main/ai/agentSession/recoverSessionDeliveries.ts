import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'

import { finalizeInterruptedParts } from '../streamManager'

export function recoverSessionDeliveries(): Set<string> {
  const affectedSessionIds = new Set<string>()
  for (const message of agentSessionMessageService.listRecoverableSessionDeliveries()) {
    if (message.delivery?.status !== 'delivering') continue
    const turnRef = message.delivery.turnRef
    if (!turnRef) {
      const result = agentSessionMessageService.failSessionDelivery(message, {
        code: 'INTERNAL_ERROR',
        message: 'Delivering Session request has no turn reference'
      })
      if (result) affectedSessionIds.add(result.sessionId)
      continue
    }
    let assistant: ReturnType<typeof agentSessionMessageService.getSessionMessage> | null = null
    try {
      assistant = agentSessionMessageService.getSessionMessage(message.sessionId, turnRef)
    } catch (error) {
      if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) throw error
    }
    if (!assistant) {
      const result = agentSessionMessageService.failSessionDelivery(message, {
        code: 'DELIVERY_TURN_DELETED',
        message: 'The delivery turn was deleted before it could be recovered'
      })
      if (result) affectedSessionIds.add(result.sessionId)
      continue
    }
    if (assistant.status === 'pending') {
      agentSessionMessageService.resolveCrashOrphanedMessages(
        [
          {
            id: assistant.id,
            data: {
              ...assistant.data,
              parts: finalizeInterruptedParts(assistant.data.parts ?? [], 'error')
            }
          }
        ],
        [message.sessionId]
      )
    }
    const result = agentSessionMessageService.finalizeSessionDelivery({
      requestSessionId: message.sessionId,
      requestMessageId: message.id,
      assistantMessageId: assistant.id,
      outcome:
        assistant.status === 'success'
          ? 'success'
          : assistant.status === 'paused' || assistant.status === 'pending'
            ? 'interrupted'
            : 'failed'
    })
    if (result) affectedSessionIds.add(result.sessionId)
  }
  return affectedSessionIds
}
