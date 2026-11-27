import { isDeepStrictEqual } from 'node:util'

import type { JSONObject, JSONValue } from '@ai-sdk/provider'
import type {
  BetaContentBlockParam,
  BetaToolUseBlock,
  BetaServerToolUseBlock,
  BetaMCPToolUseBlock
} from '@anthropic-ai/sdk/resources/beta/messages'

import { isLivePartInput, partEdits, type LivePartInput, type RuntimePartEdit } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import type { MessageDecorator } from '@main/ai/agentSession/ThreadMessageProjection'
import { extractSystemReminderBodies, SystemReminderTextFilter } from '@main/ai/steerReminder'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { stripClaudeCodeRejectionPrefix } from '@shared/ai/providerError'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isMcpContentBlock } from '@shared/utils/mcp'

import type { McpToolDisplayMetadata } from './types'

type ClaudeToolUseBlock = BetaToolUseBlock | BetaServerToolUseBlock | BetaMCPToolUseBlock
type ToolMetadata = {
  name: string
  parentToolCallId?: string | null
  sdkBlockType?: string
  serverName?: string
  serverId?: string
  toolType?: 'mcp' | 'provider'
  displayName?: string
  description?: string
}

function* reminderBodies(message: ClaudeObservation['native'][number]['message']): Generator<string> {
  if (message.type !== 'user' || !('isSynthetic' in message) || !message.isSynthetic) return
  const { content } = message.message as { content?: string | BetaContentBlockParam[] }
  if (typeof content === 'string') yield* extractSystemReminderBodies(content)
  else for (const block of content ?? []) if (block.type === 'text') yield* extractSystemReminderBodies(block.text)
}

/** Cherry display policy applied after the adapter has materialized native content. */
export class ClaudeMessageMetadata {
  private readonly reminders = new Set<string>()
  private readonly filters = new Map<string, Map<number, SystemReminderTextFilter>>()
  private readonly rejectedMessages = new Set<string>()
  private readonly thinking = new Map<
    string,
    Map<number, { startedAt: number; elapsedFrom: number; thinkingMs?: number }>
  >()
  private catalog: Record<string, McpToolDisplayMetadata> = {}

  constructor(private readonly mcpToolMetadata: Record<string, McpToolDisplayMetadata> = {}) {}

  private catalogChanged(batch: ClaudeObservation): boolean {
    const check = batch.native.length
      ? batch.native.some(({ message }) => message.type !== 'stream_event')
      : !batch.events.length ||
        batch.events.some(
          (event) => !isLivePartInput(event) || (event.type === 'message.parts' && !event.changes.length)
        )
    return check && !isDeepStrictEqual(this.catalog, this.mcpToolMetadata)
  }

  needsRecovery(batch: ClaudeObservation): boolean {
    if (
      batch.events.some((event) => event.type === 'closed' && event.reason !== 'shutdown') ||
      this.catalogChanged(batch)
    )
      return true
    for (const { message, isApiErrorMessage } of batch.native) {
      if (message.type === 'assistant' && isApiErrorMessage && !this.rejectedMessages.has(message.uuid)) return true
      for (const body of reminderBodies(message)) if (!this.reminders.has(body)) return true
    }
    return false
  }

  accept(batch: ClaudeObservation): boolean {
    let refreshAll = this.catalogChanged(batch)
    // oxlint-disable-next-line no-restricted-globals -- Refresh the MCP catalog on loadout changes before applying mutable display metadata.
    if (refreshAll) this.catalog = structuredClone(this.mcpToolMetadata)
    for (const native of batch.native) {
      const message = native.message
      if (message.type === 'assistant' && native.isApiErrorMessage && !this.rejectedMessages.has(message.uuid)) {
        this.rejectedMessages.add(message.uuid)
        refreshAll = true
      }
      for (const body of reminderBodies(message)) {
        if (!this.reminders.has(body)) refreshAll = true
        this.reminders.add(body)
      }
    }
    const live = batch.native.some((native) => native.source === 'live')
    for (const event of batch.events) {
      if (isLivePartInput(event)) {
        for (const edit of partEdits(event)) {
          if (edit.type === 'open' && edit.kind === 'reasoning' && live) this.startThinking(event.ref.id, edit.part)
          else if (edit.type === 'finish') this.finishThinking(event.ref.id, edit.part)
        }
      } else if (event.type === 'snapshot' || event.type === 'gap' || event.type === 'closed') this.filters.clear()
      else if (event.type === 'message.remove') this.filters.delete(event.ref.id)
      else if (event.type === 'message.reconcile') {
        const id = event.message.id
        this.filters.delete(id)
        for (const ref of event.replaces ?? []) {
          this.filters.delete(ref.id)
          const timing = this.thinking.get(ref.id)
          if (timing) {
            this.thinking.set(id, timing)
            this.thinking.delete(ref.id)
          }
        }
        for (const [index, part] of event.message.parts.entries()) {
          if (part.type !== 'reasoning') continue
          if (part.state === 'streaming' && live) this.startThinking(id, index)
          if (part.state === 'done' || event.message.metadata?.completeness === 'complete')
            this.finishThinking(id, index)
        }
      }
    }
    return refreshAll
  }

  private startThinking(id: string, index: number): void {
    const blocks = this.thinking.get(id) ?? new Map()
    if (blocks.has(index)) return
    blocks.set(index, { startedAt: Date.now(), elapsedFrom: performance.now() })
    this.thinking.set(id, blocks)
  }

  private finishThinking(id: string, index: number): void {
    const timing = this.thinking.get(id)?.get(index)
    if (timing) timing.thinkingMs ??= Math.round(performance.now() - timing.elapsedFrom)
  }

  readonly decorate: MessageDecorator = (message, _source, unchangedParts) => ({
    ...message,
    parts: message.parts.map((part, index) => {
      if (unchangedParts?.has(index)) return part
      if (part.type === 'dynamic-tool') return this.decorateTool(part)
      if (part.type === 'reasoning') {
        const timing = this.thinking.get(message.id)?.get(index)
        return timing
          ? {
              ...part,
              providerMetadata: {
                ...part.providerMetadata,
                cherry: {
                  startedAt: timing.startedAt,
                  ...(timing.thinkingMs === undefined ? {} : { thinkingMs: timing.thinkingMs })
                }
              }
            }
          : part
      }
      if (part.type !== 'text') return part
      const filter = this.textFilter(message.id, index, part.state === 'streaming')
      const text = this.rejectedMessages.has(message.id) ? stripClaudeCodeRejectionPrefix(part.text) : part.text
      return { ...part, text: filter.write(text) + (part.state === 'streaming' ? '' : filter.flush()) }
    })
  })

  decorateTool<T extends Extract<CherryMessagePart, { type: 'dynamic-tool' }>>(part: T): T {
    const native = part.callProviderMetadata?.anthropic
    const type = native?.type === 'mcp_tool_use' || native?.type === 'server_tool_use' ? native.type : 'tool_use'
    const state: ToolMetadata = {
      name: part.toolName,
      ...this.getToolUseMetadata({
        name: part.toolName,
        type,
        server_name: typeof native?.serverName === 'string' ? native.serverName : undefined
      })
    }
    this.mergeToolDisplayMetadata(state)
    const metadata = this.buildToolProviderMetadata(state)
    const decoration = {
      providerExecuted: true,
      title: this.getToolTitle(state),
      callProviderMetadata: { ...part.callProviderMetadata, ...metadata }
    }
    if (part.state === 'output-available')
      return {
        ...part,
        ...decoration,
        output: this.buildToolOutput(part.output, state),
        resultProviderMetadata: { ...part.resultProviderMetadata, ...metadata }
      }
    return { ...part, ...decoration }
  }

  private textFilter(id: string, part: number, streaming: boolean): SystemReminderTextFilter {
    const filter = new SystemReminderTextFilter(this.reminders)
    if (streaming) {
      let blocks = this.filters.get(id)
      if (!blocks) this.filters.set(id, (blocks = new Map()))
      blocks.set(part, filter)
    }
    return filter
  }

  decorateLive(event: LivePartInput): LivePartInput {
    const id = event.ref.id
    const changes = partEdits(event).flatMap((edit): RuntimePartEdit[] => {
      const { part } = edit
      if (edit.type === 'put')
        return [edit.value.type === 'dynamic-tool' ? { ...edit, value: this.decorateTool(edit.value) } : edit]
      if (edit.type === 'open' && edit.kind === 'text') this.textFilter(id, part, true)
      if (edit.type === 'correct' && edit.kind === 'text') {
        const filter = this.textFilter(id, part, edit.state === 'streaming')
        const text = this.rejectedMessages.has(id) ? stripClaudeCodeRejectionPrefix(edit.text) : edit.text
        return [{ ...edit, text: filter.write(text) + (edit.state === 'streaming' ? '' : filter.flush()) }]
      }
      const filters = this.filters.get(id)
      const filter = filters?.get(part)
      if (edit.type === 'append' && filter) {
        const text = filter.write(edit.text)
        return text ? [{ ...edit, text }] : []
      }
      if (edit.type === 'finish' && filter) {
        filters!.delete(part)
        if (!filters!.size) this.filters.delete(id)
        const text = filter.flush()
        return text ? [{ type: 'append', part, text }, edit] : [edit]
      }
      const timing = this.thinking.get(id)?.get(part)
      if (timing && (edit.type === 'open' || edit.type === 'correct' || edit.type === 'finish'))
        return [
          {
            ...edit,
            providerMetadata: {
              ...edit.providerMetadata,
              cherry: {
                startedAt: timing.startedAt,
                ...(timing.thinkingMs !== undefined && { thinkingMs: timing.thinkingMs })
              }
            }
          }
        ]
      return [edit]
    })
    return { type: 'message.parts', ref: event.ref, changes }
  }

  private getToolUseMetadata(
    tool: Pick<ClaudeToolUseBlock, 'name' | 'type'> & { server_name?: string }
  ): Pick<ToolMetadata, 'sdkBlockType' | 'serverName' | 'serverId' | 'toolType'> {
    if (tool.type === 'mcp_tool_use') {
      const serverName = typeof tool.server_name === 'string' ? tool.server_name : undefined
      return {
        sdkBlockType: tool.type,
        serverName,
        serverId: serverName,
        toolType: 'mcp'
      }
    }
    const parsed = parseFunctionCallToolName(tool.name)
    if (parsed) {
      return {
        sdkBlockType: tool.type,
        serverName: parsed.serverPart,
        serverId: parsed.serverPart,
        toolType: 'mcp'
      }
    }
    return {
      sdkBlockType: tool.type,
      toolType: 'provider'
    }
  }

  private resolveMcpToolDisplayMetadata(state: ToolMetadata): McpToolDisplayMetadata | undefined {
    if (state.toolType !== 'mcp' && !parseFunctionCallToolName(state.name)) return undefined
    return (
      this.mcpToolMetadata[state.name] ??
      (state.serverId ? this.mcpToolMetadata[`mcp__${state.serverId}__${state.name}`] : undefined) ??
      (state.serverName ? this.mcpToolMetadata[`mcp__${state.serverName}__${state.name}`] : undefined)
    )
  }

  private mergeToolDisplayMetadata(state: ToolMetadata): void {
    const parsed = parseFunctionCallToolName(state.name)
    if (parsed) {
      state.toolType = 'mcp'
      state.serverName = state.serverName ?? parsed.serverPart
      state.serverId = state.serverId ?? parsed.serverPart
      state.displayName = state.displayName ?? parsed.toolPart
    }

    const metadata = this.resolveMcpToolDisplayMetadata(state)
    if (!metadata) return

    state.toolType = 'mcp'
    state.serverName = metadata.serverName
    state.serverId = metadata.serverId
    state.displayName = metadata.name
    state.description = metadata.description
  }

  private getToolTitle(state: ToolMetadata): string | undefined {
    const toolName = state.displayName ?? state.name
    return state.toolType === 'mcp' && state.serverName ? `${state.serverName}: ${toolName}` : undefined
  }

  private buildToolProviderMetadata(state: ToolMetadata): Record<string, JSONObject> {
    const claudeCode: JSONObject = {
      parentToolCallId: state.parentToolCallId ?? null,
      ...(state.sdkBlockType ? { sdkBlockType: state.sdkBlockType } : {}),
      ...(state.serverName ? { serverName: state.serverName } : {}),
      ...(state.serverId ? { serverId: state.serverId } : {})
    }

    return {
      'claude-code': claudeCode,
      cherry: {
        transport: AGENT_RUNTIME_CAPABILITIES['claude-code'].transport,
        tool: {
          type: state.toolType ?? 'provider',
          ...(state.displayName ? { name: state.displayName } : {}),
          ...(state.description ? { description: state.description } : {}),
          ...(state.serverName ? { serverName: state.serverName } : {}),
          ...(state.serverId ? { serverId: state.serverId } : {})
        }
      }
    }
  }

  private buildToolOutput(output: unknown, state: ToolMetadata): unknown {
    if (state.toolType !== 'mcp') return normalizeClaudeToolResult(output)
    return {
      content: hasMcpNonTextContent(output) ? normalizeMcpToolContent(output) : normalizeClaudeToolResult(output),
      metadata: {
        type: 'mcp',
        name: state.displayName ?? state.name,
        ...(state.description ? { description: state.description } : {}),
        serverName: state.serverName ?? 'MCP',
        serverId: state.serverId ?? state.serverName ?? 'unknown'
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getContentArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.content)) return value.content
  return undefined
}

function normalizeMcpContentBlock(block: unknown): JSONObject {
  if (isMcpContentBlock(block)) return block as JSONObject

  if (!isRecord(block)) {
    return { type: 'text', text: stringifyJsonValue(block) }
  }

  if (block.type === 'image') {
    const source = block.source
    if (isRecord(source) && source.type === 'base64' && typeof source.data === 'string') {
      return {
        type: 'image',
        data: source.data,
        mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/png'
      }
    }
  }

  return { type: 'text', text: stringifyJsonValue(block) }
}

function normalizeMcpToolContent(value: unknown): JSONValue[] {
  const content = getContentArray(value)
  if (content) return content.map(normalizeMcpContentBlock)

  return [{ type: 'text', text: stringifyJsonValue(value) }]
}

function hasMcpNonTextContent(value: unknown): boolean {
  const content = getContentArray(value)
  if (!content) return false

  return content.some((block) => {
    if (!isRecord(block)) return false
    if (block.type === 'image' || block.type === 'audio') return true
    return block.type === 'resource' && isRecord(block.resource) && typeof block.resource.blob === 'string'
  })
}

export function normalizeClaudeToolResult(result: unknown): unknown {
  if (Array.isArray(result) && result.length > 0) {
    if (
      !result.every(
        (block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string'
      )
    )
      return result
    result = result.map((block) => block.text).join('\n')
  }
  if (typeof result !== 'string') return typeof result === 'object' && result !== null ? result : String(result ?? '')
  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}
