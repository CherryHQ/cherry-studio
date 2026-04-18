import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ToolApprovalRegistry')

type PendingApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  resolve: (result: PermissionResult) => void
  signal?: AbortSignal
  abortListener?: () => void
}

type DispatchDecision = {
  approved: boolean
  reason?: string
  updatedInput?: Record<string, unknown>
}

/**
 * Main-side dispatcher for tool-approval decisions. Holds each pending
 * `canUseTool` promise until the renderer's `Ai_ToolApproval_Respond` IPC
 * arrives, then resolves with the `PermissionResult` shape the Claude
 * Agent SDK expects.
 */
class ToolApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>()

  register(entry: Omit<PendingApproval, 'abortListener'>): void {
    const { approvalId, signal } = entry
    if (this.pending.has(approvalId)) {
      logger.warn('Duplicate approval registration — rejecting', { approvalId })
      entry.resolve({ behavior: 'deny', message: 'Duplicate approval registration' })
      return
    }

    if (signal?.aborted) {
      entry.resolve({ behavior: 'deny', message: 'Tool request was cancelled before approval' })
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

    entry.resolve(
      decision.approved
        ? { behavior: 'allow', updatedInput: decision.updatedInput ?? entry.originalInput }
        : { behavior: 'deny', message: decision.reason ?? 'User denied permission for this tool' }
    )
    return true
  }

  abort(sessionId: string, reason = 'session-aborted'): number {
    let aborted = 0
    for (const [approvalId, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      this.pending.delete(approvalId)
      this.detachAbort(entry)
      entry.resolve({ behavior: 'deny', message: reason })
      aborted++
    }
    if (aborted > 0) logger.info('Aborted pending approvals', { sessionId, count: aborted, reason })
    return aborted
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
export type { DispatchDecision }
