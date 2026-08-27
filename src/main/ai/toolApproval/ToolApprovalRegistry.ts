import { loggerService } from '@logger'

import { AgentApprovalLifetime, type AgentRuntimeConnectionId } from '../runtime/types'

const logger = loggerService.withContext('ToolApprovalRegistry')

/**
 * Driver-neutral tool-approval decision. Drivers map this to their SDK-native
 * result inside their own adapter/extension (Claude → `PermissionResult`, pi →
 * `tool_call` block/mutation) so no SDK type leaks into this shared path.
 */
export type DispatchDecision = {
  approved: boolean
  reason?: string
  updatedInput?: Record<string, unknown>
}

export type PendingApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  lifetime: AgentApprovalLifetime
  connectionId?: AgentRuntimeConnectionId
  messageId?: string
  resolve: (decision: DispatchDecision) => void
  signal?: AbortSignal
  abortListener?: () => void
  claimToken: symbol
}

export type ApprovalRegistration = Pick<
  PendingApproval,
  'approvalId' | 'sessionId' | 'connectionId' | 'toolCallId' | 'lifetime' | 'messageId'
>
type PendingApprovalRegistration = Omit<PendingApproval, 'abortListener' | 'claimToken' | 'lifetime'> &
  (
    | { lifetime?: AgentApprovalLifetime.ExecutionBound; connectionId?: never }
    | { lifetime: AgentApprovalLifetime.SessionMessage; connectionId: AgentRuntimeConnectionId }
  )

export interface AgentMessageApprovalClaim extends ApprovalRegistration {
  readonly connectionId: AgentRuntimeConnectionId
  readonly token: symbol
}

/**
 * Main-side dispatcher for tool-approval decisions. Holds each pending tool
 * request until the renderer's `ai.tool.respond_approval` request arrives, then
 * resolves with the neutral `DispatchDecision`. This module is shared by every
 * agent-session driver; the SDK-native conversion lives in each driver.
 */
class ToolApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>()

  /**
   * Register a pending approval. Returns `true` when the request is now pending a
   * renderer decision, `false` when it was resolved synchronously (duplicate id, or
   * an already-aborted signal). Callers must only surface the approval UI (emit a
   * `tool-approval-request`) when this returns `true` — otherwise the request has no
   * pending entry to answer, so the card can never be dispatched.
   */
  register(entry: PendingApprovalRegistration): boolean {
    const { approvalId, signal } = entry
    if (this.pending.has(approvalId)) {
      logger.warn('Duplicate approval registration — rejecting', { approvalId })
      entry.resolve({ approved: false, reason: 'Duplicate approval registration' })
      return false
    }

    if (signal?.aborted) {
      entry.resolve({ approved: false, reason: 'Tool request was cancelled before approval' })
      return false
    }

    const stored: PendingApproval = {
      ...entry,
      lifetime: entry.lifetime ?? AgentApprovalLifetime.ExecutionBound,
      claimToken: Symbol(approvalId)
    }
    if (signal && stored.lifetime === AgentApprovalLifetime.ExecutionBound) {
      const abortListener = () => this.dispatch(approvalId, { approved: false, reason: 'aborted' })
      stored.abortListener = abortListener
      signal.addEventListener('abort', abortListener, { once: true })
    }

    this.pending.set(approvalId, stored)
    return true
  }

  /** Returns `undefined` for unknown ids (already dispatched / session expired). */
  peek(approvalId: string): ApprovalRegistration | undefined {
    const entry = this.pending.get(approvalId)
    if (!entry) return undefined
    return {
      approvalId: entry.approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      lifetime: entry.lifetime,
      connectionId: entry.connectionId,
      messageId: entry.messageId
    }
  }

  claimMessage(
    approvalId: string,
    sessionId: string,
    connectionId: AgentRuntimeConnectionId
  ): AgentMessageApprovalClaim | undefined {
    const entry = this.pending.get(approvalId)
    if (
      !entry ||
      entry.sessionId !== sessionId ||
      entry.connectionId !== connectionId ||
      entry.lifetime !== AgentApprovalLifetime.SessionMessage
    )
      return undefined
    return {
      approvalId: entry.approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      lifetime: entry.lifetime,
      connectionId,
      messageId: entry.messageId,
      token: entry.claimToken
    }
  }

  bindMessage(claim: AgentMessageApprovalClaim, messageId: string): boolean {
    const entry = this.pending.get(claim.approvalId)
    if (
      !entry ||
      entry.claimToken !== claim.token ||
      entry.sessionId !== claim.sessionId ||
      entry.connectionId !== claim.connectionId ||
      entry.lifetime !== AgentApprovalLifetime.SessionMessage
    ) {
      return false
    }
    entry.messageId = messageId
    return true
  }

  listConnection(sessionId: string, connectionId: AgentRuntimeConnectionId): AgentMessageApprovalClaim[] {
    return [...this.pending.values()].flatMap((entry) => {
      if (
        entry.sessionId !== sessionId ||
        entry.connectionId !== connectionId ||
        entry.lifetime !== AgentApprovalLifetime.SessionMessage
      ) {
        return []
      }
      return [
        {
          approvalId: entry.approvalId,
          sessionId: entry.sessionId,
          toolCallId: entry.toolCallId,
          lifetime: entry.lifetime,
          connectionId,
          messageId: entry.messageId,
          token: entry.claimToken
        }
      ]
    })
  }

  listSession(sessionId: string, lifetime?: AgentApprovalLifetime): ApprovalRegistration[] {
    return [...this.pending.values()].flatMap((entry) => {
      if (entry.sessionId !== sessionId || (lifetime && entry.lifetime !== lifetime)) return []
      return [
        {
          approvalId: entry.approvalId,
          sessionId: entry.sessionId,
          toolCallId: entry.toolCallId,
          lifetime: entry.lifetime,
          messageId: entry.messageId
        }
      ]
    })
  }

  listAll(): ApprovalRegistration[] {
    return [...this.pending.values()].map((entry) => ({
      approvalId: entry.approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      lifetime: entry.lifetime,
      connectionId: entry.connectionId,
      messageId: entry.messageId
    }))
  }

  /** Returns `undefined` for unknown ids (already dispatched / session expired). */
  dispatch(approvalId: string, decision: DispatchDecision): ApprovalRegistration | undefined {
    const entry = this.pending.get(approvalId)
    if (!entry) return undefined
    this.pending.delete(approvalId)
    this.detachAbort(entry)
    entry.resolve(decision)
    return {
      approvalId: entry.approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      lifetime: entry.lifetime,
      connectionId: entry.connectionId,
      messageId: entry.messageId
    }
  }

  dispatchClaim(claim: AgentMessageApprovalClaim, decision: DispatchDecision): ApprovalRegistration | undefined {
    const entry = this.pending.get(claim.approvalId)
    if (
      !entry ||
      entry.claimToken !== claim.token ||
      entry.sessionId !== claim.sessionId ||
      entry.connectionId !== claim.connectionId
    ) {
      return undefined
    }
    return this.dispatch(claim.approvalId, decision)
  }

  abort(sessionId: string, reason = 'session-aborted'): number {
    let aborted = 0
    for (const [approvalId, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      this.pending.delete(approvalId)
      this.detachAbort(entry)
      entry.resolve({ approved: false, reason })
      aborted++
    }
    if (aborted > 0) logger.info('Aborted pending approvals', { sessionId, count: aborted, reason })
    return aborted
  }

  /**
   * Drop every pending approval. Call from the owning service's shutdown
   * path so the resolve callbacks don't strand dangling closures (and the
   * held tool promises don't hang forever) across a service restart.
   */
  clear(reason = 'service-shutdown'): number {
    const count = this.pending.size
    if (count === 0) return 0
    for (const [, entry] of this.pending) {
      this.detachAbort(entry)
      entry.resolve({ approved: false, reason })
    }
    this.pending.clear()
    logger.info('Cleared all pending approvals', { count, reason })
    return count
  }

  size(): number {
    return this.pending.size
  }

  private detachAbort(entry: PendingApproval): void {
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener('abort', entry.abortListener)
    }
  }
}

export const toolApprovalRegistry = new ToolApprovalRegistry()
