import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import type { AgentRuntimeConnectionId, AgentRuntimeToolApprovalRequest } from '@main/ai/runtime/types'
import { AgentApprovalLifetime } from '@main/ai/runtime/types'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart, MessageSnapshot } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import { type DispatchDecision, toolApprovalRegistry } from './ToolApprovalRegistry'

const logger = loggerService.withContext('AgentMessageInteractionCoordinator')

class AgentMessageInteractionCoordinator {
  present(input: {
    sessionId: string
    request: AgentRuntimeToolApprovalRequest & { lifetime: AgentApprovalLifetime.SessionMessage }
    modelId: UniqueModelId
    messageSnapshot?: MessageSnapshot
  }): AgentSessionMessageEntity | undefined {
    const { sessionId, request } = input
    const claim = toolApprovalRegistry.claimMessage(request.approvalId, sessionId, request.connectionId)
    if (!claim) return undefined
    const part = {
      type: `tool-${request.toolName}`,
      toolCallId: request.toolCallId,
      state: 'approval-requested',
      input: request.input,
      approval: { id: request.approvalId },
      ...(request.providerMetadata ? { callProviderMetadata: request.providerMetadata } : {})
    } as CherryMessagePart
    try {
      const message = agentSessionMessageService.saveMessage(
        {
          sessionId,
          message: {
            role: 'assistant',
            status: 'success',
            data: { parts: [part] },
            modelId: input.modelId,
            messageSnapshot: input.messageSnapshot
          }
        },
        { publishDataChange: true }
      )
      if (toolApprovalRegistry.bindMessage(claim, message.id)) return message
      agentSessionMessageService.applyToolApprovalDecision(sessionId, message.id, {
        approvalId: request.approvalId,
        approved: false,
        reason: 'The runtime session ended before this approval could be presented'
      })
      return undefined
    } catch (error) {
      logger.error('Failed to persist session-message approval', { sessionId, approvalId: request.approvalId, error })
      toolApprovalRegistry.dispatch(request.approvalId, {
        approved: false,
        reason: 'Unable to present this approval request to the user'
      })
      return undefined
    }
  }

  respond(approvalId: string, decision: DispatchDecision, anchorId?: string): boolean {
    const pending = toolApprovalRegistry.peek(approvalId)
    if (!pending || pending.lifetime !== AgentApprovalLifetime.SessionMessage) return false
    const messageId = pending.messageId
    if (!messageId || (anchorId && anchorId !== messageId)) return false
    const applied = agentSessionMessageService.applyToolApprovalDecision(pending.sessionId, messageId, {
      approvalId,
      approved: decision.approved,
      ...(decision.reason !== undefined && { reason: decision.reason }),
      ...(decision.updatedInput !== undefined && { updatedInput: decision.updatedInput })
    })
    if (!applied) return false
    return toolApprovalRegistry.dispatch(approvalId, decision) !== undefined
  }

  teardownConnection(sessionId: string, connectionId: AgentRuntimeConnectionId, reason = 'session-ended'): number {
    const pending = toolApprovalRegistry.listConnection(sessionId, connectionId)
    const messageApprovals = pending.flatMap((approval) =>
      approval.messageId
        ? [
            {
              sessionId,
              messageId: approval.messageId,
              decision: { approvalId: approval.approvalId, approved: false, reason }
            }
          ]
        : []
    )
    agentSessionMessageService.applyToolApprovalDecisions(messageApprovals)
    let resolved = 0
    for (const approval of pending) {
      if (toolApprovalRegistry.dispatchClaim(approval, { approved: false, reason })) resolved += 1
    }
    return resolved
  }

  clear(reason = 'service-shutdown'): number {
    const connections = new Map<string, { sessionId: string; connectionId: AgentRuntimeConnectionId }>()
    for (const approval of toolApprovalRegistry.listAll()) {
      if (approval.lifetime !== AgentApprovalLifetime.SessionMessage || !approval.connectionId) continue
      connections.set(`${approval.sessionId}:${approval.connectionId}`, {
        sessionId: approval.sessionId,
        connectionId: approval.connectionId
      })
    }
    let resolved = 0
    for (const { sessionId, connectionId } of connections.values()) {
      resolved += this.teardownConnection(sessionId, connectionId, reason)
    }
    resolved += toolApprovalRegistry.clear(reason)
    return resolved
  }
}

export const agentMessageInteractionCoordinator = new AgentMessageInteractionCoordinator()
