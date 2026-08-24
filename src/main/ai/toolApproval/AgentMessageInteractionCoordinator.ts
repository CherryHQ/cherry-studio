import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import type { AgentRuntimeToolApprovalRequest } from '@main/ai/runtime/types'
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
    const claim = toolApprovalRegistry.claimMessage(request.approvalId, sessionId)
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

  teardownSession(sessionId: string, reason = 'session-ended'): number {
    const pending = toolApprovalRegistry.listSession(sessionId)
    const messageApprovals = pending.flatMap((approval) =>
      approval.lifetime === AgentApprovalLifetime.SessionMessage && approval.messageId
        ? [
            {
              sessionId,
              messageId: approval.messageId,
              decision: { approvalId: approval.approvalId, approved: false, reason }
            }
          ]
        : []
    )
    try {
      agentSessionMessageService.applyToolApprovalDecisions(messageApprovals)
    } catch (error) {
      logger.error('Failed to terminalize session-message approvals during teardown', { sessionId, error })
    }
    let resolved = 0
    for (const approval of pending) {
      if (toolApprovalRegistry.dispatch(approval.approvalId, { approved: false, reason })) resolved += 1
    }
    return resolved
  }

  clear(reason = 'service-shutdown'): number {
    const sessionIds = new Set(toolApprovalRegistry.listAll().map(({ sessionId }) => sessionId))
    let resolved = 0
    for (const sessionId of sessionIds) resolved += this.teardownSession(sessionId, reason)
    return resolved
  }
}

export const agentMessageInteractionCoordinator = new AgentMessageInteractionCoordinator()
