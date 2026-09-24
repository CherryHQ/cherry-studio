import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { resolveLinkedNotifyChannel } from '@main/ai/runtime/agentMcpServers'
import { findBuiltinToolPolicy } from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'

import type { AgentRuntimeEvent } from '../types'
import type { UarHostMcpBridge } from './UarHostMcpBridge'
import { toUarToolName } from './uarToolNames'

const logger = loggerService.withContext('UarToolApprovalController')

type UarApprovalValue = {
  approvalId?: unknown
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
    if (typeof value.toolCallId !== 'string' || typeof value.name !== 'string') {
      throw new Error('UAR emitted an invalid tool approval request')
    }
    const input = parseToolInput(value.arguments)
    const pending: PendingApproval = {
      rawApprovalId: typeof value.approvalId === 'string' ? value.approvalId : undefined,
      rawToolCallId: value.toolCallId,
      toolCallId: ensureToolInput(value.toolCallId, value.name, input),
      toolName: value.name,
      input
    }
    const disposition = this.disposition(pending.toolName)
    if (disposition === 'deny') {
      await this.resolve(pending.rawApprovalId, false)
      return
    }
    if (disposition === 'approve') {
      await this.approve(pending)
      return
    }
    await this.prompt(pending)
  }

  private async approve(input: PendingApproval): Promise<void> {
    const identity = { toolCallId: input.rawToolCallId, toolName: input.toolName, input: input.input }
    this.options.bridge.approveToolCall(identity)
    try {
      await this.resolve(input.rawApprovalId, true)
    } catch (error) {
      this.options.bridge.revokeToolCall(identity)
      throw error
    }
  }

  private async prompt(input: PendingApproval): Promise<void> {
    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(this.options.sessionId)
    if (interactionState.userResponse === 'unavailable') {
      await this.resolve(input.rawApprovalId, false)
      return
    }
    const approvalId = `uar:${this.options.runId}:${input.rawApprovalId ?? input.rawToolCallId}`
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    const pending = toolApprovalRegistry.register({
      approvalId,
      sessionId: this.options.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      originalInput: { ...input.input },
      presentation,
      signal: this.options.signal,
      resolve: (decision) => this.dispatch(input, decision)
    })
    if (!pending) return
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
    if (
      !decision.approved &&
      (this.options.isClosed() || this.options.signal.aborted || decision.reason?.startsWith('UAR turn '))
    ) {
      return
    }
    if (decision.approved && decision.updatedInput) {
      logger.warn('Editing tool input is not supported by the UAR runtime; rejecting', { toolName: input.toolName })
    }
    const approved = decision.approved && !decision.updatedInput
    const identity = { toolCallId: input.rawToolCallId, toolName: input.toolName, input: input.input }
    if (approved) this.options.bridge.approveToolCall(identity)
    void this.resolve(input.rawApprovalId, approved).catch((error) => {
      if (approved) this.options.bridge.revokeToolCall(identity)
      if (!this.options.signal.aborted && !this.options.isClosed()) this.options.emit({ type: 'error', error })
    })
  }

  private disposition(toolName: string): 'approve' | 'deny' | 'prompt' {
    const agent = agentService.getAgent(this.options.agentId)
    if (!agent) return 'deny'
    if ((agent.disabledTools ?? []).map(toUarToolName).includes(toolName)) return 'deny'
    const mode = agent.configuration?.permission_mode ?? 'default'
    if (mode === 'plan') return 'deny'

    const linkedChannel = resolveLinkedNotifyChannel(this.options.sessionId, agent.id)
    const mountedServers = resolveMountedMcpServers(agent, {
      browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
      channelLinked: linkedChannel !== null
    })
    const builtin = findBuiltinToolPolicy(`mcp__${toolName}`, mountedServers)
    if (builtin?.approval === 'auto') return 'approve'
    if (builtin?.approval === 'required') {
      return mode === 'bypassPermissions' && builtin.bypassApproval === 'lift' ? 'approve' : 'prompt'
    }
    if (mode === 'bypassPermissions' || mode === 'auto') return 'approve'
    if (mode === 'acceptEdits' && this.isManagedFilesystemTool(toolName)) return 'approve'
    return 'prompt'
  }

  private isManagedFilesystemTool(toolName: string): boolean {
    return mcpServerService
      .list({})
      .items.some(
        (server) => server.reference?.startsWith('filesystem:') && toolName.startsWith(toUarToolName(`${server.id}__`))
      )
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

function parseToolInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
