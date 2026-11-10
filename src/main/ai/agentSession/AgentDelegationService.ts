import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AgentDelegationSnapshot } from '@shared/ai/agentSessionDelivery'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

import { buildAgentSessionTopicId } from './topic'

const logger = loggerService.withContext('AgentDelegationService')
const DELEGATION_TIMEOUT_MS = 10 * 60_000
class DelegationSettled extends Error {}

@Injectable('AgentDelegationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AgentSessionDeliveryService', 'AgentSessionRuntimeService', 'AiStreamManager'])
export class AgentDelegationService extends BaseService {
  private readonly inFlight = new Set<Promise<void>>()
  private stopping = false

  protected override onInit(): void {
    this.stopping = false
    this.registerDisposable(
      agentService.onAgentUpdated(({ agent }) => {
        if (agent.type === 'local' && !agent.configuration?.localRuntime?.enabled) {
          void this.cancelMatching(
            (message) => message.delivery?.receiver.agentId === agent.id,
            'TARGET_UNAVAILABLE'
          ).catch((error) => logger.error('Failed to cancel disabled Agent delegations', error))
        }
      })
    )
    this.registerInterval(async () => {
      await this.cancelMatching(
        (message) => Date.now() - Date.parse(message.createdAt) >= DELEGATION_TIMEOUT_MS,
        'TIMEOUT'
      )
    }, 5_000)
  }

  protected override async onStop(): Promise<void> {
    this.stopping = true
    await Promise.allSettled([...this.inFlight])
  }

  private request(originSessionId: string, requestId: string): AgentSessionMessageEntity {
    agentSessionService.getById(originSessionId)
    const request = agentSessionMessageService
      .listSessionDeliveries({ sessionId: originSessionId, requestId })
      .find(
        (message) =>
          message.id === requestId &&
          message.delivery?.delegation &&
          message.delivery.sender.sessionId === originSessionId
      )
    if (!request) throw new Error('Delegation does not belong to this Session')
    return request
  }

  read(originSessionId: string, requestId: string): AgentDelegationSnapshot {
    const request = this.request(originSessionId, requestId)
    const delivery = request.delivery!
    const target = agentSessionService.getById(request.sessionId)
    const terminal = delivery.status === 'consumed' || delivery.status === 'failed'
    return {
      requestId,
      originSessionId,
      targetSessionId: request.sessionId,
      agentName: delivery.receiverSnapshot?.agentName ?? '',
      workspacePath: target.workspace.path,
      delivery,
      approvals:
        !terminal &&
        delivery.status === 'delivering' &&
        application.get('AgentSessionRuntimeService').getLiveAssistantMessageId(request.sessionId) === delivery.turnRef
          ? toolApprovalRegistry.listForSession(request.sessionId)
          : [],
      terminal
    }
  }

  async cancel(originSessionId: string, requestId: string, reason = 'CANCELLED'): Promise<void> {
    if (this.stopping) throw new Error('Delegation service is stopping')
    const operation = this.cancelRequest(originSessionId, requestId, reason)
    this.inFlight.add(operation)
    try {
      await operation
    } finally {
      this.inFlight.delete(operation)
    }
  }

  private async cancelRequest(originSessionId: string, requestId: string, reason: string): Promise<void> {
    const request = this.request(originSessionId, requestId)
    const manager = application.get('AiStreamManager')
    const runtime = application.get('AgentSessionRuntimeService')
    const deliveries = application.get('AgentSessionDeliveryService')
    if (deliveries.isWriteQuiesced || manager.isWriteQuiesced) throw new Error('Delegation writes are paused')
    try {
      await manager.abortAndDrain(buildAgentSessionTopicId(request.sessionId), reason, () => {
        const current = this.request(originSessionId, requestId)
        const delivery = current.delivery!
        if (delivery.status === 'consumed' || delivery.status === 'failed') throw new DelegationSettled()
        const error = {
          code: reason,
          message:
            reason === 'TIMEOUT' ? 'Delegated task exceeded its ten-minute deadline' : 'Delegated task was cancelled'
        }
        if (delivery.status === 'accepted') {
          const result = agentSessionMessageService.failSessionDelivery(current, error)
          if (result) deliveries.kick(result.sessionId)
          throw new DelegationSettled()
        }
        if (runtime.getLiveAssistantMessageId(current.sessionId) !== delivery.turnRef) throw new DelegationSettled()
        agentSessionMessageService.transitionSessionDelivery(current.sessionId, current.id, 'delivering', {
          expected: ['delivering'],
          error
        })
      })
    } catch (error) {
      if (!(error instanceof DelegationSettled)) throw error
    }
  }

  respond(originSessionId: string, requestId: string, approvalId: string, decision: DispatchDecision): boolean {
    const snapshot = this.read(originSessionId, requestId)
    if (!snapshot.approvals.some((approval) => approval.approvalId === approvalId)) return false
    return application.get('AgentSessionRuntimeService').respondToolApproval(approvalId, decision)
  }

  async cancelOwnedBy(sessionIds: string[]): Promise<void> {
    const owners = new Set(sessionIds)
    await this.cancelMatching(
      (message) => owners.has(message.delivery!.sender.sessionId) && !owners.has(message.sessionId),
      'CALLER_SESSION_DELETED'
    )
  }

  private async cancelMatching(
    predicate: (message: AgentSessionMessageEntity) => boolean,
    reason: string
  ): Promise<void> {
    for (const message of agentSessionMessageService.listRecoverableSessionDeliveries()) {
      if (!message.delivery?.delegation || !predicate(message)) continue
      await this.cancel(message.delivery.sender.sessionId, message.id, reason)
    }
  }
}
