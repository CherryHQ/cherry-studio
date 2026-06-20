import type { BaseTool, McpTool, McpToolResponse, McpToolResponseStatus, NormalToolResponse } from '@renderer/types'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { DynamicToolUIPart, ProviderMetadata, ToolUIPart, UIDataTypes, UIMessagePart, UITools } from 'ai'
import { getToolName, isToolUIPart } from 'ai'

import { AgentToolsType } from './agent/types'
import { isMetaToolName } from './meta/metaToolNames'

/** AI-SDK-v6 ToolUIPart approval-state string literals. */
export const APPROVAL_REQUESTED = 'approval-requested'
export const APPROVAL_RESPONDED = 'approval-responded'
export const CLAUDE_AGENT_TRANSPORT = 'claude-agent'
const AGENT_MCP_TOOLS_PREFIX = 'mcp__'
const AGENT_TOOL_NAMES = new Set<string>(Object.values(AgentToolsType))

type ToolType = 'mcp' | 'builtin' | 'provider'

type ToolMetadata = {
  description?: string
  name?: string
  serverId?: string
  serverName?: string
  type?: ToolType
}

type ToolResponsePart = ToolUIPart<UITools> | DynamicToolUIPart

export type ToolResponseLike = McpToolResponse | NormalToolResponse

export interface ToolRenderItem {
  id: string
  toolResponse: ToolResponseLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToolType(value: unknown): value is ToolType {
  return value === 'mcp' || value === 'builtin' || value === 'provider'
}

function normalizeToolName(part: ToolResponsePart): string {
  const toolName = getToolName(part)
  return toolName.trim() || 'unknown'
}

function mapPartStateToStatus(state: string | undefined): McpToolResponseStatus {
  switch (state) {
    case 'output-available':
      return 'done'
    case 'output-error':
      return 'error'
    case 'output-denied':
    case 'cancelled':
      return 'cancelled'
    case 'input-streaming':
      return 'streaming'
    case 'input-available':
      return 'invoking'
    case 'approval-requested':
    case 'approval-responded':
      return 'pending'
    default:
      return 'pending'
  }
}

function extractOutputMetadata(part: ToolResponsePart): { response: unknown; metadata?: ToolMetadata } {
  const output = part.output
  if (!isRecord(output)) return { response: output }

  const metadata = isRecord(output.metadata) ? output.metadata : undefined
  if ('content' in output || metadata) {
    const normalizedMeta: ToolMetadata | undefined = metadata
      ? {
          description: typeof metadata.description === 'string' ? metadata.description : undefined,
          name: typeof metadata.name === 'string' ? metadata.name : undefined,
          serverId: typeof metadata.serverId === 'string' ? metadata.serverId : undefined,
          serverName: typeof metadata.serverName === 'string' ? metadata.serverName : undefined,
          type: isToolType(metadata.type) ? metadata.type : undefined
        }
      : undefined
    return { response: output.content, metadata: normalizedMeta }
  }

  return { response: output }
}

function hasProviderMetadata(part: ToolResponsePart, provider: string): boolean {
  return isRecord(part.callProviderMetadata) && provider in part.callProviderMetadata
}

function isLegacyAgentToolName(toolName: string): boolean {
  return AGENT_TOOL_NAMES.has(toolName) || toolName.startsWith(AGENT_MCP_TOOLS_PREFIX)
}

function extractCherryToolMetadataFrom(metadata: ProviderMetadata | undefined): ToolMetadata | undefined {
  if (!isRecord(metadata)) return undefined
  const cherry = isRecord(metadata.cherry) ? metadata.cherry : undefined
  const tool = cherry && isRecord(cherry.tool) ? cherry.tool : undefined
  if (!tool) return undefined
  return {
    description: typeof tool.description === 'string' ? tool.description : undefined,
    name: typeof tool.name === 'string' ? tool.name : undefined,
    serverId: typeof tool.serverId === 'string' ? tool.serverId : undefined,
    serverName: typeof tool.serverName === 'string' ? tool.serverName : undefined,
    type: isToolType(tool.type) ? tool.type : undefined
  }
}

function extractCherryToolMetadata(part: ToolResponsePart): ToolMetadata | undefined {
  const resultProviderMetadata = 'resultProviderMetadata' in part ? part.resultProviderMetadata : undefined
  return (
    extractCherryToolMetadataFrom(part.callProviderMetadata) ?? extractCherryToolMetadataFrom(resultProviderMetadata)
  )
}

function extractClaudeParentToolCallIdFrom(metadata: ProviderMetadata | undefined): string | undefined {
  if (!isRecord(metadata)) return undefined
  const claudeCode = isRecord(metadata['claude-code']) ? metadata['claude-code'] : undefined
  const parentToolCallId = claudeCode?.parentToolCallId ?? claudeCode?.parentToolUseId
  return typeof parentToolCallId === 'string' && parentToolCallId ? parentToolCallId : undefined
}

function extractParentToolUseId(part: ToolResponsePart): string | undefined {
  const resultProviderMetadata = 'resultProviderMetadata' in part ? part.resultProviderMetadata : undefined
  return (
    extractClaudeParentToolCallIdFrom(part.callProviderMetadata) ??
    extractClaudeParentToolCallIdFrom(resultProviderMetadata)
  )
}

function hasCherryTransport(metadata: ProviderMetadata | undefined): boolean {
  if (!isRecord(metadata)) return false
  const cherry = isRecord(metadata.cherry) ? metadata.cherry : undefined
  return cherry?.transport === CLAUDE_AGENT_TRANSPORT
}

function resolveToolType(part: ToolResponsePart, toolName: string, metadata?: ToolMetadata): ToolType {
  if (isMetaToolName(toolName)) return 'builtin'
  if (metadata?.type) return metadata.type
  if (parseFunctionCallToolName(toolName)) return 'mcp'
  if (hasProviderMetadata(part, 'claude-code')) return 'provider'
  if (hasCherryTransport(part.callProviderMetadata)) return 'provider'
  if (part.type === 'dynamic-tool' && isLegacyAgentToolName(toolName)) return 'provider'
  if (part.type === 'dynamic-tool') return 'mcp'
  if (toolName.startsWith('builtin_')) return 'builtin'
  return 'builtin'
}

function buildMcpToolDescriptor(toolName: string, metadata?: ToolMetadata): McpTool {
  const parsed = parseFunctionCallToolName(toolName)
  const serverId = metadata?.serverId ?? parsed?.serverPart ?? 'unknown'
  const serverName = metadata?.serverName ?? parsed?.serverPart ?? 'MCP'
  const displayName = metadata?.name ?? parsed?.toolPart ?? toolName
  return {
    id: `${serverId}__${toolName}`,
    name: displayName,
    description: metadata?.description,
    type: 'mcp',
    serverId,
    serverName,
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
}

function buildBaseToolDescriptor(toolType: Exclude<ToolType, 'mcp'>, toolCallId: string, toolName: string): BaseTool {
  const baseTool: BaseTool = {
    id: toolCallId,
    name: toolName,
    type: toolType
  }
  return baseTool
}

function normalizeErrorOutput(part: ToolResponsePart): unknown {
  if (part.state !== 'output-error') return undefined
  return {
    isError: true,
    content: [{ type: 'text', text: part.errorText || 'Error' }]
  }
}

export function buildToolResponseFromPart(part: CherryMessagePart, fallbackId?: string): ToolResponseLike | null {
  if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) return null

  const toolPart = part as unknown as ToolResponsePart
  const toolCallId = toolPart.toolCallId || fallbackId
  if (!toolCallId) return null
  const toolName = normalizeToolName(toolPart)
  const status = mapPartStateToStatus(toolPart.state)

  const { response: rawResponse, metadata: outputMetadata } = extractOutputMetadata(toolPart)
  const cherryMetadata = extractCherryToolMetadata(toolPart)
  const metadata = outputMetadata ?? cherryMetadata
  const toolType = resolveToolType(toolPart, toolName, metadata)
  const response = status === 'error' ? normalizeErrorOutput(toolPart) : rawResponse
  const parentToolUseId = extractParentToolUseId(toolPart)

  const partialArguments =
    (status === 'streaming' || status === 'invoking') && typeof toolPart.input === 'string' ? toolPart.input : undefined

  if (toolType === 'mcp') {
    const tool = buildMcpToolDescriptor(toolName, metadata)
    const mcpResponse: McpToolResponse = {
      id: toolCallId,
      tool,
      arguments: toolPart.input as McpToolResponse['arguments'],
      status,
      response,
      toolCallId,
      ...(parentToolUseId ? { parentToolUseId } : {}),
      ...(partialArguments ? { partialArguments } : {})
    }
    return mcpResponse
  }

  const tool = buildBaseToolDescriptor(toolType, toolCallId, toolName)
  const normalResponse: NormalToolResponse = {
    id: toolCallId,
    tool,
    arguments: toolPart.input as NormalToolResponse['arguments'],
    status,
    response,
    toolCallId,
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(partialArguments ? { partialArguments } : {})
  }
  return normalResponse
}

export function buildToolRenderItemFromPart(part: CherryMessagePart, id: string): ToolRenderItem | null {
  const toolResponse = buildToolResponseFromPart(part, id)
  if (!toolResponse) return null
  return { id, toolResponse }
}

/** Matched `ToolUIPart` plus decoded approval fields. */
export type ToolApprovalMatch = {
  part: CherryMessagePart
  state: string
  toolCallId: string
  messageId: string
  approvalId: string
  input?: unknown
}

/**
 * Locate the `ToolUIPart` in PartsContext matching `toolCallId`. Used by
 * every approval card + waiting-state check — AI-SDK-v6 is the sole
 * source of truth for approval state after the message-parts migration.
 */
export function findToolPartByCallId(
  partsMap: Record<string, CherryMessagePart[]> | null | undefined,
  toolCallId: string | undefined
): ToolApprovalMatch | null {
  if (!partsMap || !toolCallId) return null
  for (const [messageId, parts] of Object.entries(partsMap)) {
    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) continue
      const p = part as unknown as ToolResponsePart
      if (p.toolCallId !== toolCallId) continue
      const approvalId = p.approval?.id
      if (!approvalId) continue
      return {
        part,
        state: p.state ?? '',
        toolCallId,
        messageId,
        approvalId,
        input: p.input
      }
    }
  }
  return null
}

export function isToolPartAwaitingApproval(
  partsMap: Record<string, CherryMessagePart[]> | null | undefined,
  toolCallId: string | undefined
): boolean {
  return findToolPartByCallId(partsMap, toolCallId)?.state === APPROVAL_REQUESTED
}
