import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('ToolApprovalRegistry')
const invocationInput = '__cherry_tool_approval'

type ApprovedInvocation = {
  sessionId: string
  toolName: string
  inputJson: string
  signal: AbortSignal
  validate: () => void
  dispose: () => void
}

/**
 * Driver-neutral tool-approval decision. Drivers map this to their SDK-native
 * result inside their own adapter/extension (Claude → `PermissionResult`, pi →
 * `tool_call` block/mutation) so no SDK type leaks into this shared path.
 */
export type DispatchDecision = {
  applicationScope?: 'always' | 'session' | 'reject'
  approved: boolean
  reason?: string
  /** Marks a reason the user actually supplied, so drivers can attribute it to the user rather
   *  than to the host (registry/abort strings must stay unattributed). */
  reasonSource?: 'user'
  updatedInput?: Record<string, unknown>
}

type PendingApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  originalInput: Record<string, unknown>
  presentation: 'stream' | 'message' | 'application'
  resolve: (decision: DispatchDecision) => void
  signal?: AbortSignal
  abortListener?: () => void
}

type ApprovalRegistration = Pick<PendingApproval, 'sessionId' | 'toolCallId' | 'presentation'>
type PendingApprovalRegistration = Omit<PendingApproval, 'abortListener' | 'presentation'> & {
  presentation?: PendingApproval['presentation']
}

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
  private readonly invocations = new Map<string, ApprovedInvocation>()
  private readonly _onAborted = new Emitter<AbortedApproval>()

  /**
   * Fired once for each pending approval cancelled by its signal or registry cleanup.
   * Listeners retire any persisted card parked at `approval-requested`.
   */
  public readonly onAborted: Event<AbortedApproval> = this._onAborted.event

  bindInvocation({
    sessionId,
    toolName,
    input,
    signal,
    validate
  }: Pick<ApprovedInvocation, 'sessionId' | 'toolName' | 'signal' | 'validate'> & {
    input: Record<string, unknown>
  }): Record<string, unknown> {
    signal.throwIfAborted()
    validate()
    const originalInput = { ...input }
    delete originalInput[invocationInput]
    const token = randomUUID()
    const dispose = () => {
      this.invocations.delete(token)
      signal.removeEventListener('abort', dispose)
    }
    this.invocations.set(token, {
      sessionId,
      toolName,
      inputJson: JSON.stringify(originalInput),
      signal,
      validate,
      dispose
    })
    signal.addEventListener('abort', dispose, { once: true })
    return { ...originalInput, [invocationInput]: token }
  }

  async runApprovedInvocation<T>(
    request: {
      sessionId: string
      toolName: string
      input: Record<string, unknown>
      signal: AbortSignal
      permissionMode: AgentPermissionMode | undefined
    },
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const input = { ...request.input }
    const token = input[invocationInput]
    delete input[invocationInput]
    request.signal.throwIfAborted()
    if (token === undefined && request.permissionMode === 'bypassPermissions') return run(request.signal)
    const approval = typeof token === 'string' ? this.invocations.get(token) : undefined
    if (!approval) throw new Error('Tool approval is no longer valid')
    approval.dispose()
    if (
      approval.sessionId !== request.sessionId ||
      approval.toolName !== request.toolName ||
      !isDeepStrictEqual(JSON.parse(approval.inputJson), input)
    )
      throw new Error('Tool approval does not match this invocation')
    approval.validate()
    const signal = AbortSignal.any([request.signal, approval.signal])
    signal.throwIfAborted()
    const result = await run(signal)
    signal.throwIfAborted()
    return result
  }

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

    const stored: PendingApproval = { ...entry, presentation: entry.presentation ?? 'stream' }
    if (signal) {
      const abortListener = () => this.cancel([approvalId], 'aborted')
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
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      presentation: entry.presentation
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
      presentation: entry.presentation
    }
  }

  abort(sessionId: string, reason = 'session-aborted'): number {
    for (const invocation of this.invocations.values()) {
      if (invocation.sessionId === sessionId) invocation.dispose()
    }
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
    for (const invocation of this.invocations.values()) invocation.dispose()
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
