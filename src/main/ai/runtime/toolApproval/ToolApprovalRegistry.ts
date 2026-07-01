import { loggerService } from '@logger'

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

type PendingApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  resolve: (decision: DispatchDecision) => void
  signal?: AbortSignal
  abortListener?: () => void
}

/**
 * Main-side dispatcher for tool-approval decisions. Holds each pending tool
 * request until the renderer's `Ai_ToolApproval_Respond` IPC arrives, then
 * resolves with the neutral `DispatchDecision`. This module is shared by every
 * agent-session driver; the SDK-native conversion lives in each driver.
 */
class ToolApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>()

  register(entry: Omit<PendingApproval, 'abortListener'>): void {
    const { approvalId, signal } = entry
    if (this.pending.has(approvalId)) {
      logger.warn('Duplicate approval registration — rejecting', { approvalId })
      entry.resolve({ approved: false, reason: 'Duplicate approval registration' })
      return
    }

    if (signal?.aborted) {
      entry.resolve({ approved: false, reason: 'Tool request was cancelled before approval' })
      return
    }

    const stored: PendingApproval = { ...entry }
    if (signal) {
      const abortListener = () => this.dispatch(approvalId, { approved: false, reason: 'aborted' })
      stored.abortListener = abortListener
      signal.addEventListener('abort', abortListener, { once: true })
    }

    this.pending.set(approvalId, stored)
  }

  /** Returns `false` for unknown ids (already dispatched / session expired). */
  dispatch(approvalId: string, decision: DispatchDecision): boolean {
    const entry = this.pending.get(approvalId)
    if (!entry) return false
    this.pending.delete(approvalId)
    this.detachAbort(entry)
    entry.resolve(decision)
    return true
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
