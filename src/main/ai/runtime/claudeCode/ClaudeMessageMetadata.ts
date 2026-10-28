import type { JSONObject, JSONValue } from '@ai-sdk/provider'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaToolUseBlock,
  BetaServerToolUseBlock,
  BetaMCPToolUseBlock
} from '@anthropic-ai/sdk/resources/beta/messages'

import type { ContentItem } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import type { MessageDecorator } from '@main/ai/agentSession/ThreadMessageProjection'
import { extractSystemReminderBodies, SystemReminderTextFilter } from '@main/ai/steerReminder'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryUIMessage } from '@shared/data/types/message'
import { isMcpContentBlock } from '@shared/utils/mcp'

import type { McpToolDisplayMetadata } from './types'

type ClaudeToolUseBlock = BetaToolUseBlock | BetaServerToolUseBlock | BetaMCPToolUseBlock
type ClaudeToolResultBlock = Extract<BetaContentBlock | BetaContentBlockParam, { tool_use_id: string }>
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

type Block = BetaContentBlock | BetaContentBlockParam

/** Rich native blocks captured with the normalized batch, scoped to one thread. */
export class ClaudeMessageMetadata {
  private readonly blocks = new Map<string, Block>()
  readonly items = new Map<string, ContentItem>()
  readonly removed = new Set<string>()

  private readonly reminders = new Set<string>()
  private readonly denied = new Set<string>()
  private readonly thinking = new Map<string, { startedAt: number; elapsedFrom: number; thinkingMs?: number }>()

  constructor(private readonly mcpToolMetadata: Record<string, McpToolDisplayMetadata> = {}) {}

  accept(batch: ClaudeObservation): void {
    for (const native of batch.native) {
      const message = native.message
      if (
        native.source === 'live' &&
        message.type === 'system' &&
        'subtype' in message &&
        message.subtype === 'permission_denied'
      )
        this.denied.add(message.tool_use_id)
      if (message.type === 'assistant' || message.type === 'user') {
        const body = message.message as { content?: string | Block[] }
        const content =
          typeof body.content === 'string' ? [{ type: 'text' as const, text: body.content }] : body.content
        if (message.type === 'user' && 'isSynthetic' in message && message.isSynthetic)
          for (const block of content ?? [])
            if (block.type === 'text')
              for (const body of extractSystemReminderBodies(block.text)) this.reminders.add(body)
        content?.forEach((block, index) => this.blocks.set(`${message.uuid}:${index}`, block))
      } else if (message.type === 'stream_event' && message.event.type === 'content_block_start') {
        for (const event of batch.events)
          if (event.type === 'item.upsert') this.blocks.set(event.item.ref.id, message.event.content_block)
      }
    }
    for (const event of batch.events) {
      if (event.type === 'snapshot') {
        this.items.clear()
        for (const item of event.items) this.items.set(item.ref.id, item)
      } else if (event.type === 'item.upsert') {
        const id = event.item.ref.id
        for (const ref of event.replaces ?? []) {
          const timing = this.thinking.get(ref.id)
          if (timing) {
            this.thinking.set(id, timing)
            this.thinking.delete(ref.id)
          }
        }
        if (event.item.type === 'message' && event.item.parts.some((part) => part.type === 'reasoning')) {
          if (
            event.item.completeness === 'partial' &&
            !this.thinking.has(id) &&
            batch.native.some((native) => native.source === 'live')
          )
            this.thinking.set(id, { startedAt: Date.now(), elapsedFrom: performance.now() })
          const timing = this.thinking.get(id)
          if (timing && event.item.completeness === 'complete')
            timing.thinkingMs ??= Math.round(performance.now() - timing.elapsedFrom)
        }
        for (const ref of event.replaces ?? []) this.items.delete(ref.id)
        this.items.set(event.item.ref.id, event.item)
      } else if (event.type === 'item.remove') {
        this.items.delete(event.ref.id)
        this.removed.add(event.ref.id)
      }
    }
    for (const uuid of batch.retracted)
      for (const id of this.blocks.keys()) if (id.startsWith(`${uuid}:`)) this.removed.add(id)
  }

  readonly decorate: MessageDecorator = (message, { item, result }) => {
    const block = this.blocks.get(item.ref.id)
    if (
      item.type === 'tool-call' &&
      block &&
      (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use')
    )
      return this.decorateTool(message, block, result && this.blocks.get(result.ref.id))
    if (!block) return message
    if (block.type === 'image' && block.source.type === 'base64')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: block.source.media_type,
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        ]
      }
    if (block.type === 'document' && block.source.type === 'base64')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: block.source.media_type,
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        ]
      }
    if ((block.type === 'image' || block.type === 'document') && block.source.type === 'url')
      return {
        ...message,
        parts: [
          { type: 'file', mediaType: block.type === 'image' ? 'image/*' : 'application/pdf', url: block.source.url }
        ]
      }
    if (block.type === 'document' && block.source.type === 'text')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: 'text/plain',
            url: `data:text/plain;base64,${Buffer.from(block.source.data).toString('base64')}`
          }
        ]
      }
    if (block.type === 'redacted_thinking')
      return {
        ...message,
        parts: [
          { type: 'reasoning', text: '', state: 'done', providerMetadata: { anthropic: { redactedData: block.data } } }
        ]
      }
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type === 'reasoning') {
          const timing = this.thinking.get(item.ref.id)
          return {
            ...part,
            providerMetadata: {
              ...part.providerMetadata,
              ...(block.type === 'thinking' && typeof block.signature === 'string'
                ? { anthropic: { signature: block.signature } }
                : {}),
              ...(timing
                ? {
                    cherry: {
                      startedAt: timing.startedAt,
                      ...(timing.thinkingMs === undefined ? {} : { thinkingMs: timing.thinkingMs })
                    }
                  }
                : {})
            }
          }
        }
        if (part.type !== 'text') return part
        const filter = new SystemReminderTextFilter(this.reminders)
        const text = filter.write(part.text) + (part.state === 'streaming' ? '' : filter.flush())
        return {
          ...part,
          text,
          ...(block.type === 'text' && block.citations?.length
            ? { providerMetadata: { anthropic: { citations: JSON.parse(JSON.stringify(block.citations)) } } }
            : {})
        }
      })
    }
  }

  archive() {
    const items = [...this.items.values()].filter((item) => !item.ref.id.startsWith('live:'))
    return {
      items,
      aliases: Object.fromEntries(items.map((item) => [item.ref.id, item.ref.id])),
      removed: [...this.removed]
    }
  }
  decorateTool(
    message: CherryUIMessage,
    block: Pick<ClaudeToolUseBlock, 'id' | 'name' | 'type'> & { server_name?: string },
    result?: BetaContentBlock | BetaContentBlockParam
  ): CherryUIMessage {
    const state: ToolMetadata = {
      name: block.name,
      ...this.getToolUseMetadata(block)
    }
    this.mergeToolDisplayMetadata(state)
    const metadata = this.buildToolProviderMetadata(state)
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== 'dynamic-tool') return part
        const decoration = {
          toolCallId: block.id,
          providerExecuted: true as const,
          title: this.getToolTitle(state),
          callProviderMetadata: metadata
        }
        if (this.denied.has(block.id))
          return {
            type: 'dynamic-tool',
            toolName: part.toolName,
            input: part.input,
            ...decoration,
            state: 'output-denied',
            approval: { id: block.id, approved: false }
          }
        if (result && 'tool_use_id' in result && part.state === 'output-available')
          return {
            ...part,
            ...decoration,
            output: this.buildToolOutput(normalizeClaudeToolResult(result.content), state, result.content),
            resultProviderMetadata: metadata
          }
        return { ...part, ...decoration }
      })
    }
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

  private buildToolOutput(
    result: NonNullable<JSONValue>,
    state: ToolMetadata,
    rawContent?: ClaudeToolResultBlock['content']
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
