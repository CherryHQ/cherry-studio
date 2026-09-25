import { application } from '@application'
import { loggerService } from '@logger'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'

import type { AgentRuntimeEvent } from '../types'
import type { UarHostMcpBridge } from './UarHostMcpBridge'

const logger = loggerService.withContext('UarToolApprovalController')

type UarApprovalValue = {
  approvalId?: unknown
  admissionId?: unknown
  invocationId?: unknown
  toolCallId?: unknown
  name?: unknown
  arguments?: unknown
}

interface UarToolApprovalOptions {
  sessionId: string
  agentId: string
  runId: string
  generation: number
  principal: string
  signal: AbortSignal
  bridge: UarHostMcpBridge
  emit(event: AgentRuntimeEvent): void
  isClosed(): boolean
}

type PendingApproval = {
  rawApprovalId?: string
  admissionId: string
  invocationId?: string
  rawToolCallId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export class UarToolApprovalController {
  constructor(private readonly options: UarToolApprovalOptions) {}

  abort(reason: string): void {
    toolApprovalRegistry.abort(this.options.sessionId, reason)
  }

  async handle(
    rawValue: Record<string, unknown>,
    ensureToolInput: (rawToolCallId: string, toolName: string, input: Record<string, unknown>) => string
  ): Promise<void> {
    const value = rawValue as UarApprovalValue
    if (
      typeof value.toolCallId !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.admissionId !== 'string'
    ) {
      throw new Error('UAR emitted an invalid tool approval request')
    }
    const input = parseSafeActionDisplay(value.arguments)
    const pending: PendingApproval = {
      rawApprovalId: typeof value.approvalId === 'string' ? value.approvalId : undefined,
      admissionId: value.admissionId,
      invocationId: typeof value.invocationId === 'string' ? value.invocationId : undefined,
      rawToolCallId: value.toolCallId,
      toolCallId: ensureToolInput(value.toolCallId, value.name, input),
      toolName: value.name,
      input
    }
    await this.prompt(pending)
  }

  private async prompt(input: PendingApproval): Promise<void> {
    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(this.options.sessionId)
    if (interactionState.userResponse === 'unavailable') {
      await this.recordAndResolve(input, false)
      return
    }
    const approvalId = `uar:${this.options.runId}:${input.rawApprovalId ?? input.rawToolCallId}`
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    const registration = toolApprovalRegistry.registerOrReattach({
      approvalId,
      sessionId: this.options.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      originalInput: { ...input.input },
      presentation,
      signal: this.options.signal,
      resolve: (decision) => this.dispatch(input, decision)
    })
    if (registration !== 'registered') return
    this.options.emit({
      type: 'tool-approval-request',
      request: {
        approvalId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: { ...input.input },
        presentation
      }
    })
  }

  private dispatch(input: PendingApproval, decision: DispatchDecision): void {
    const interrupted =
      this.options.isClosed() || this.options.signal.aborted || decision.reason?.startsWith('UAR turn ')
    if (interrupted) {
      try {
        this.options.bridge.cancelAdmission(input.admissionId, input.invocationId, 'cancelled')
      } catch (error) {
        logger.warn('Failed to persist cancelled UAR tool admission', { admissionId: input.admissionId, error })
      }
      return
    }
    if (decision.approved && decision.updatedInput) {
      logger.warn('Editing tool input is not supported by the UAR runtime; rejecting', { toolName: input.toolName })
    }
    const approved = decision.approved && !decision.updatedInput
    void this.recordAndResolve(input, approved).catch((error) => {
      if (!this.options.signal.aborted && !this.options.isClosed()) this.options.emit({ type: 'error', error })
    })
  }

  private async recordAndResolve(input: PendingApproval, approved: boolean): Promise<void> {
    if (!this.options.bridge.recordHumanDecision(input.admissionId, approved)) {
      throw new Error('uar_approval_stale')
    }
    await this.resolve(input.rawApprovalId, approved)
  }

  private async resolve(approvalId: string | undefined, approved: boolean): Promise<void> {
    const response = await application.get('UarSidecarService').requestCurrent(
      `/api/uar/runs/${encodeURIComponent(this.options.runId)}/tool-approval`,
      this.options.principal,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved, ...(approvalId ? { approval_id: approvalId } : {}) })
      },
      this.options.generation
    )
    if (!response) throw new Error('UAR restarted before the tool approval was resolved')
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000).trim()
      throw new Error(`UAR rejected the tool approval (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
    }
  }
}

function parseSafeActionDisplay(value: unknown): Record<string, unknown> {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (!isRecord(parsed)) return {}
  const safe: Record<string, unknown> = {}
  for (const key of ['operation', 'server', 'target']) {
    const entry = parsed[key]
    if (typeof entry === 'string') safe[key] = entry.slice(0, 512)
  }
  if (typeof parsed.detailsAvailable === 'boolean') safe.detailsAvailable = parsed.detailsAvailable
  return safe
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
