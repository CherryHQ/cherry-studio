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

const logger = loggerService.withContext('UarAguiAdapter')

type AguiEvent = {
  type?: unknown
  messageId?: unknown
  delta?: unknown
  code?: unknown
  message?: unknown
  name?: unknown
  runId?: unknown
  toolCallId?: unknown
  toolCallName?: unknown
  arguments?: unknown
  value?: unknown
}

type UarApprovalValue = {
  approvalId?: unknown
  toolCallId?: unknown
  name?: unknown
  arguments?: unknown
}

interface UarAguiAdapterOptions {
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

export class UarAguiAdapter {
  private readonly startedTools = new Set<string>()
  private readonly completedInputs = new Set<string>()
  private textOpen = false
  private textId: string
  private terminal = false

  constructor(private readonly options: UarAguiAdapterOptions) {
    this.textId = `${options.runId}:assistant`
  }

  async consume(response: Response): Promise<void> {
    if (!response.body) throw new Error('UAR stream returned no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        this.handleFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
      if (done) break
    }
    if (buffer.trim()) this.handleFrame(buffer)
    if (!this.terminal && !this.options.isClosed()) throw new Error('UAR stream ended before a terminal event')
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const event = JSON.parse(data) as AguiEvent
    if (typeof event.runId === 'string' && event.runId !== this.options.runId) {
      throw new Error(`UAR emitted an event for the wrong run: ${event.runId}`)
    }
    switch (event.type) {
      case 'TEXT_MESSAGE_CONTENT':
        this.handleText(event)
        break
      case 'TOOL_CALL_START':
        if (typeof event.toolCallId === 'string' && typeof event.toolCallName === 'string') {
          this.ensureToolInput(event.toolCallId, event.toolCallName)
        }
        break
      case 'TOOL_CALL_END':
        if (typeof event.toolCallId === 'string' && typeof event.toolCallName === 'string') {
          this.ensureToolInput(event.toolCallId, event.toolCallName, parseToolInput(event.arguments))
        }
        break
      case 'CUSTOM':
        this.handleCustom(event)
        break
      case 'RUN_FINISHED':
        this.finish()
        break
      case 'RUN_ERROR':
        this.fail(event)
        break
    }
  }

  private handleText(event: AguiEvent): void {
    if (typeof event.delta !== 'string' || !event.delta) return
    const id = typeof event.messageId === 'string' ? event.messageId : `${this.options.runId}:assistant`
    if (!this.textOpen) {
      this.textOpen = true
      this.textId = id
      this.options.emit({ type: 'chunk', chunk: { type: 'text-start', id } })
    }
    this.options.emit({ type: 'chunk', chunk: { type: 'text-delta', id, delta: event.delta } })
  }

  private handleCustom(event: AguiEvent): void {
    if (event.name !== 'uar.tool.approval_required' || !isRecord(event.value)) return
    const value = event.value as UarApprovalValue
    if (typeof value.toolCallId !== 'string' || typeof value.name !== 'string') {
      throw new Error('UAR emitted an invalid tool approval request')
    }
    const input = parseToolInput(value.arguments)
    const toolCallId = this.ensureToolInput(value.toolCallId, value.name, input)
    void this.handleToolApproval({
      rawApprovalId: typeof value.approvalId === 'string' ? value.approvalId : undefined,
      rawToolCallId: value.toolCallId,
      toolCallId,
      toolName: value.name,
      input
    }).catch((error) => {
      if (!this.options.signal.aborted && !this.options.isClosed()) this.options.emit({ type: 'error', error })
    })
  }

  private finish(): void {
    this.terminal = true
    toolApprovalRegistry.abort(this.options.sessionId, 'UAR turn finished')
    if (this.textOpen) this.options.emit({ type: 'chunk', chunk: { type: 'text-end', id: this.textId } })
    this.options.emit({ type: 'turn-complete' })
  }

  private fail(event: AguiEvent): void {
    this.terminal = true
    toolApprovalRegistry.abort(this.options.sessionId, 'UAR turn failed')
    this.options.emit({
      type: 'error',
      error: new Error(typeof event.message === 'string' ? event.message : `UAR run failed (${String(event.code)})`)
    })
  }

  private ensureToolInput(rawToolCallId: string, toolName: string, input?: Record<string, unknown>): string {
    const toolCallId = `uar:${this.options.runId}:${rawToolCallId}`
    if (!this.startedTools.has(toolCallId)) {
      this.startedTools.add(toolCallId)
      this.options.emit({ type: 'chunk', chunk: { type: 'tool-input-start', toolCallId, toolName } })
    }
    if (input && !this.completedInputs.has(toolCallId)) {
      this.completedInputs.add(toolCallId)
      this.options.emit({ type: 'chunk', chunk: { type: 'tool-input-available', toolCallId, toolName, input } })
    }
    return toolCallId
  }

  private async handleToolApproval(input: {
    rawApprovalId?: string
    rawToolCallId: string
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }): Promise<void> {
    const disposition = this.toolApprovalDisposition(input.toolName)
    if (disposition === 'deny') {
      await this.resolveToolApproval(input.rawApprovalId, false)
      return
    }
    if (disposition === 'approve') {
      const identity = { toolCallId: input.rawToolCallId, toolName: input.toolName, input: input.input }
      this.options.bridge.approveToolCall(identity)
      try {
        await this.resolveToolApproval(input.rawApprovalId, true)
      } catch (error) {
        this.options.bridge.revokeToolCall(identity)
        throw error
      }
      return
    }

    const interactionState = application.get('AgentSessionRuntimeService').getInteractionState(this.options.sessionId)
    if (interactionState.userResponse === 'unavailable') {
      await this.resolveToolApproval(input.rawApprovalId, false)
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
      resolve: (decision) => this.dispatchToolApproval(input, decision)
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

  private dispatchToolApproval(
    input: { rawApprovalId?: string; rawToolCallId: string; toolName: string; input: Record<string, unknown> },
    decision: DispatchDecision
  ): void {
    if (
      !decision.approved &&
      (this.options.isClosed() || this.options.signal.aborted || decision.reason?.startsWith('UAR turn '))
    )
      return
    if (decision.approved && decision.updatedInput) {
      logger.warn('Editing tool input is not supported by the UAR runtime; rejecting', { toolName: input.toolName })
    }
    const approved = decision.approved && !decision.updatedInput
    const identity = { toolCallId: input.rawToolCallId, toolName: input.toolName, input: input.input }
    if (approved) this.options.bridge.approveToolCall(identity)
    void this.resolveToolApproval(input.rawApprovalId, approved).catch((error) => {
      if (approved) this.options.bridge.revokeToolCall(identity)
      if (!this.options.signal.aborted && !this.options.isClosed()) this.options.emit({ type: 'error', error })
    })
  }

  private toolApprovalDisposition(toolName: string): 'approve' | 'deny' | 'prompt' {
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
    if (mode === 'acceptEdits' && isManagedFilesystemTool(toolName)) return 'approve'
    return 'prompt'
  }

  private async resolveToolApproval(approvalId: string | undefined, approved: boolean): Promise<void> {
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

export function toUarToolName(toolName: string): string {
  const wireName = toolName.startsWith('mcp__') ? toolName.slice(5) : toolName
  return wireName.replace(/[^A-Za-z0-9_-]/g, '_')
}

function isManagedFilesystemTool(toolName: string): boolean {
  return mcpServerService
    .list({})
    .items.some(
      (server) => server.reference?.startsWith('filesystem:') && toolName.startsWith(toUarToolName(`${server.id}__`))
    )
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
