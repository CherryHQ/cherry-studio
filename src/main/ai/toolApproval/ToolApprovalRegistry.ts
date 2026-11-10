import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'

const logger = loggerService.withContext('ToolApprovalRegistry')

/**
 * Driver-neutral tool-approval decision. Drivers map this to their SDK-native
 * result inside their own adapter/extension (Claude → `PermissionResult`, pi →
 * `tool_call` block/mutation) so no SDK type leaks into this shared path.
 */
export type DispatchDecision = {
  approved: boolean
  reason?: string
  /** Marks a reason the user actually supplied, so drivers can attribute it to the user rather
   *  than to the host (registry/abort strings must stay unattributed). */
  reasonSource?: 'user'
  updatedInput?: Record<string, unknown>
}

export type ApprovalAnchor = {
  kind: 'reply' | 'message'
  messageId: string
  contextId: string
}

type PendingApproval = {
  registrationId: string
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  anchor?: ApprovalAnchor
  resolve: (decision: DispatchDecision) => void
  signal?: AbortSignal
  abortListener?: () => void
}

type ApprovalRegistration = Pick<PendingApproval, 'registrationId' | 'sessionId' | 'toolCallId' | 'anchor'>
type PendingApprovalRegistration = Omit<PendingApproval, 'registrationId' | 'abortListener' | 'anchor'>

/** An approval killed without a user decision — see `ToolApprovalRegistry.onAborted`. */
export type AbortedApproval = ApprovalRegistration & {
  approvalId: string
  /** The reason handed to the driver that was waiting on this approval. */
  reason: string
}

/**
 * Main-side dispatcher for tool-approval decisions. Holds each pending tool
 * request until the renderer's `ai.tool.respond_approval` request arrives, then
 * resolves with the neutral `DispatchDecision`. This module is shared by every
 * agent-session driver; the SDK-native conversion lives in each driver.
 */
class ToolApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly _onAborted = new Emitter<AbortedApproval>()

  /**
   * Fired once for each pending approval cancelled by its signal or registry cleanup.
   * Listeners retire any persisted card parked at `approval-requested`.
   */
  public readonly onAborted: Event<AbortedApproval> = this._onAborted.event

  /**
   * Register a pending approval. Returns its registration ID when pending a
   * renderer decision, `undefined` when it was resolved synchronously (duplicate id, or
   * an already-aborted signal). Callers must only surface the approval UI (emit a
   * `tool-approval-request`) when this returns an ID — otherwise the request has no
   * pending entry to answer, so the card can never be dispatched.
   */
  register(entry: PendingApprovalRegistration): string | undefined {
    const { approvalId, signal } = entry
    if (this.pending.has(approvalId)) {
      logger.warn('Duplicate approval registration — rejecting', { approvalId })
      entry.resolve({ approved: false, reason: 'Duplicate approval registration' })
      return undefined
    }

    if (signal?.aborted) {
      entry.resolve({ approved: false, reason: 'Tool request was cancelled before approval' })
      return undefined
    }

    const stored: PendingApproval = { ...entry, registrationId: randomUUID() }
    if (signal) {
      const abortListener = () => this.cancel([approvalId], 'aborted')
      stored.abortListener = abortListener
      signal.addEventListener('abort', abortListener, { once: true })
    }

    this.pending.set(approvalId, stored)
    return stored.registrationId
  }

  bind(approvalId: string, registrationId: string, anchor: ApprovalAnchor): boolean {
    const entry = this.pending.get(approvalId)
    if (!entry || entry.registrationId !== registrationId || entry.anchor) return false
    entry.anchor = anchor
    return true
  }

  cancelRequest(approvalId: string, registrationId: string, reason: string): void {
    if (this.pending.get(approvalId)?.registrationId === registrationId) this.cancel([approvalId], reason)
  }

  /** Returns `undefined` for unknown ids (already dispatched / session expired). */
  peek(approvalId: string): ApprovalRegistration | undefined {
    const entry = this.pending.get(approvalId)
    if (!entry) return undefined
    return {
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      registrationId: entry.registrationId,
      anchor: entry.anchor
    }
  }

  /** Returns `undefined` for unknown ids (already dispatched / session expired). */
  dispatch(approvalId: string, decision: DispatchDecision): ApprovalRegistration | undefined {
    const entry = this.pending.get(approvalId)
    if (!entry) return undefined
    this.pending.delete(approvalId)
    this.detachAbort(entry)
    entry.resolve(decision)
    return {
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      registrationId: entry.registrationId,
      anchor: entry.anchor
    }
  }

  abort(sessionId: string, reason = 'session-aborted'): number {
    const approvalIds = [...this.pending.values()]
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.approvalId)
    const count = this.cancel(approvalIds, reason)
    if (count > 0) logger.info('Aborted pending approvals', { sessionId, count, reason })
    return count
  }

  /**
   * Drop every pending approval. Call from the owning service's shutdown
   * path so the resolve callbacks don't strand dangling closures (and the
   * held tool promises don't hang forever) across a service restart.
   */
  clear(reason = 'service-shutdown'): number {
    const count = this.cancel([...this.pending.keys()], reason)
    if (count > 0) logger.info('Cleared all pending approvals', { count, reason })
    return count
  }

  size(): number {
    return this.pending.size
  }

  hasSession(sessionId: string): boolean {
    return [...this.pending.values()].some((entry) => entry.sessionId === sessionId)
  }

  private cancel(approvalIds: readonly string[], reason: string): number {
    const aborted: AbortedApproval[] = []
    for (const approvalId of approvalIds) {
      const registration = this.dispatch(approvalId, { approved: false, reason })
      if (registration) aborted.push({ ...registration, approvalId, reason })
    }
    // Notify after the sweep so listeners can register new approvals.
    for (const entry of aborted) this._onAborted.fire(entry)
    return aborted.length
  }

  private detachAbort(entry: PendingApproval): void {
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener('abort', entry.abortListener)
    }
  }
}

export const toolApprovalRegistry = new ToolApprovalRegistry()
