import { isDeepStrictEqual } from 'node:util'

import type { JSONObject, JSONValue } from '@ai-sdk/provider'
import type {
  BetaContentBlockParam,
  BetaToolUseBlock,
  BetaServerToolUseBlock,
  BetaMCPToolUseBlock
} from '@anthropic-ai/sdk/resources/beta/messages'

import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import type { MessageDecorator } from '@main/ai/agentSession/ThreadMessageProjection'
import { extractSystemReminderBodies, SystemReminderTextFilter } from '@main/ai/steerReminder'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
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

/** Cherry display policy applied after the adapter has materialized native content. */
export class ClaudeMessageMetadata {
  private readonly reminders = new Set<string>()
  private readonly thinking = new Map<string, { startedAt: number; elapsedFrom: number; thinkingMs?: number }>()
  private catalog: Record<string, McpToolDisplayMetadata> = {}

  constructor(private readonly mcpToolMetadata: Record<string, McpToolDisplayMetadata> = {}) {}

  accept(batch: ClaudeObservation): boolean {
    let refreshAll = !isDeepStrictEqual(this.catalog, this.mcpToolMetadata)
    if (refreshAll) this.catalog = structuredClone(this.mcpToolMetadata)
    for (const native of batch.native) {
      const message = native.message
      if (message.type === 'user' && 'isSynthetic' in message && message.isSynthetic) {
        const body = message.message as { content?: string | BetaContentBlockParam[] }
        const content =
          typeof body.content === 'string' ? [{ type: 'text' as const, text: body.content }] : body.content
        for (const block of content ?? [])
          if (block.type === 'text')
            for (const body of extractSystemReminderBodies(block.text)) {
              if (!this.reminders.has(body)) refreshAll = true
              this.reminders.add(body)
            }
      }
    }
    for (const event of batch.events) {
      if (event.type === 'message.upsert') {
        const id = event.message.id
        for (const ref of event.replaces ?? []) {
          const timing = this.thinking.get(ref.id)
          if (timing) {
            this.thinking.set(id, timing)
            this.thinking.delete(ref.id)
          }
        }
        if (event.message.parts.some((part) => part.type === 'reasoning')) {
          if (
            event.message.metadata?.completeness === 'partial' &&
            !this.thinking.has(id) &&
            batch.native.some((native) => native.source === 'live')
          )
            this.thinking.set(id, { startedAt: Date.now(), elapsedFrom: performance.now() })
          const timing = this.thinking.get(id)
          if (timing && event.message.metadata?.completeness === 'complete')
            timing.thinkingMs ??= Math.round(performance.now() - timing.elapsedFrom)
        }
      }
    }
    return refreshAll
  }

  readonly decorate: MessageDecorator = (message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === 'dynamic-tool') {
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
            output: this.buildToolOutput(normalizeClaudeToolResult(part.output), state, part.output),
            resultProviderMetadata: { ...part.resultProviderMetadata, ...metadata }
          }
        return { ...part, ...decoration }
      }
      if (part.type === 'reasoning') {
        const timing = this.thinking.get(message.id)
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
      const filter = new SystemReminderTextFilter(this.reminders)
      return { ...part, text: filter.write(part.text) + (part.state === 'streaming' ? '' : filter.flush()) }
    })
  })

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

  private buildToolOutput(
    result: NonNullable<JSONValue>,
    state: ToolMetadata,
    rawContent?: unknown
  ): NonNullable<JSONValue> {
    if (state.toolType !== 'mcp') return result
    return {
      content: hasMcpNonTextContent(rawContent) ? normalizeMcpToolContent(rawContent) : result,
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

export function normalizeClaudeToolResult(result: unknown): NonNullable<JSONValue> {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return result
    }
  }
  if (Array.isArray(result) && result.length > 0) {
    const textBlocks = result
      .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)

    if (textBlocks.length !== result.length) return JSON.parse(JSON.stringify(result))
    const combined = textBlocks.join('\n')
    try {
      return JSON.parse(combined)
    } catch {
      return combined
    }
  }
  return typeof result === 'object' && result !== null ? JSON.parse(JSON.stringify(result)) : String(result ?? '')
}
