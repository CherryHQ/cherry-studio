import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'

import { interruptedReplyParts } from '../streamManager'

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
    let assistant: ReturnType<typeof agentSessionMessageService.readSessionMessageForRecovery> | null = null
    try {
      assistant = agentSessionMessageService.readSessionMessageForRecovery(message.sessionId, turnRef)
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
      const { streamCheckpoint, ...data } = assistant.data
      agentSessionMessageService.resolveCrashOrphanedMessages(
        [
          {
            id: assistant.id,
            data: {
              ...data,
              parts: interruptedReplyParts(streamCheckpoint ?? data.parts ?? [])
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
